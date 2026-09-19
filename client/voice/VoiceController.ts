import { atom, Atom, JsonValue, react } from 'tldraw'
import { ChatHistoryItem } from '../../shared/types/ChatHistoryItem'
import type { TldrawAgent } from '../agent/TldrawAgent'
import { createStt, SttEngineInstance } from './stt'
import { prefetchTts, TtsQueue } from './tts'
import { fetchLinksForPrompt } from './links'
import { getVoiceSettings, voiceSettings } from './VoiceSettings'

export type VoiceStatus = 'idle' | 'listening' | 'thinking' | 'speaking'

/**
 * Glue between the microphone, the agent and the speakers.
 *
 * Listening: speech-to-text produces a final transcript, which is sent to the
 * agent exactly like a typed chat message.
 *
 * Speaking: the controller watches the agent's chat history. Every time a
 * `message` action *completes*, its text is queued for text-to-speech. Drawing
 * actions keep streaming onto the canvas while the sentence is being spoken,
 * which is what makes it feel like a tutor talking while they draw.
 *
 * Nothing here touches the model prompt, so voice adds zero LLM tokens.
 */
export class VoiceController {
	readonly $status: Atom<VoiceStatus>
	readonly $interim: Atom<string>
	readonly $error: Atom<string | null>

	private stt: SttEngineInstance | null = null
	private tts = new TtsQueue()

	// Pacing: drawing actions wait until the most recent spoken sentence has started.
	private sentencesQueued = 0
	private sentencesStarted = 0

	// Sentence streaming: how much of the current message action is already queued.
	private msgSpokenChars = 0
	private msgLastText = ''
	private gateWaiters: (() => void)[] = []
	/** Never hold the drawing longer than this if audio is slow or missing. */
	private static GATE_TIMEOUT_MS = 8000
	private spoken = new WeakSet<ChatHistoryItem>()
	private disposers: (() => void)[] = []
	private disposed = false

	constructor(private agent: TldrawAgent) {
		this.$status = atom('voice.status', 'idle')
		this.$interim = atom('voice.interim', '')
		this.$error = atom('voice.error', null)

		// Don't read out history that was already on screen when the page loaded.
		for (const item of agent.chat.getHistory()) this.spoken.add(item)

		// Speaking happens in `gateAction` as sentences stream in, so the voice
		// starts as soon as the first sentence exists instead of waiting for the
		// model to finish it. History items are only tracked here for cancel logic.

		// Pace the canvas to the voice.
		agent.actionGate = (action) => this.gateAction(action)
		this.disposers.push(
			() => {
				if (agent.actionGate) agent.actionGate = null
			},
			this.tts.onStart(() => {
				this.sentencesStarted++
				this.releaseGate()
			})
		)

		// Keep the status atom in sync with the agent and the TTS queue.
		this.disposers.push(
			this.tts.onChange(() => this.refreshStatus()),
			this.tts.onError((message) => this.$error.set(message)),
			react('voice: status from agent', () => {
				agent.requests.isGenerating()
				this.refreshStatus()
			})
		)

		// Hands-free: once the tutor has gone quiet, open the mic again.
		this.disposers.push(
			react('voice: hands-free loop', () => {
				const status = this.$status.get()
				const handsFree = voiceSettings.handsFree.get()
				if (!handsFree || status !== 'idle') return
				if (this.lastStatus === 'speaking' || this.lastStatus === 'thinking') {
					// Small delay so the last audio frame isn't picked up by the mic.
					setTimeout(() => {
						if (!this.disposed && this.$status.get() === 'idle' && voiceSettings.handsFree.get()) {
							void this.startListening()
						}
					}, 400)
				}
				this.lastStatus = status
			})
		)

		// Stop talking if the user cancels or starts a new request.
		this.disposers.push(
			react('voice: cancel speech on new prompt', () => {
				const history = agent.chat.getHistory()
				const last = history[history.length - 1]
				if (last && last.type === 'prompt' && last.promptSource === 'user' && !this.spoken.has(last)) {
					this.spoken.add(last)
					this.tts.cancel()
					this.resetGate()
				}
			})
		)
	}

	private lastStatus: VoiceStatus = 'idle'

	/**
	 * Called before each streamed action is applied. Spoken sentences pass
	 * straight through (and are counted). Everything else waits until the
	 * latest sentence has begun playing, so the drawing lands during the
	 * sentence that explains it.
	 */
	private async gateAction(action: { _type?: string; complete: boolean; text?: string }) {
		if (this.disposed || !voiceSettings.speak.get()) return
		if (action._type === 'message') {
			this.speakStreamingMessage(action)
			return
		}
		if (this.sentencesStarted >= this.sentencesQueued) return
		await new Promise<void>((resolve) => {
			const timer = setTimeout(() => {
				this.gateWaiters = this.gateWaiters.filter((w) => w !== release)
				resolve()
			}, VoiceController.GATE_TIMEOUT_MS)
			const release = () => {
				clearTimeout(timer)
				resolve()
			}
			this.gateWaiters.push(release)
		})
	}

	/**
	 * Speak a message action as it streams in: every finished sentence is sent
	 * to text-to-speech immediately, so the voice starts within a couple of
	 * seconds instead of after the whole paragraph is written.
	 */
	private speakStreamingMessage(action: { complete: boolean; text?: string }) {
		const text = action.text ?? ''

		// A fresh message (streaming restarted or a new action) resets the cursor.
		if (!text.startsWith(this.msgLastText.slice(0, this.msgSpokenChars))) {
			this.msgSpokenChars = 0
		}
		this.msgLastText = text

		// Queue every completed sentence beyond what's already been queued.
		const unspoken = text.slice(this.msgSpokenChars)
		const boundary = /([.!?])(\s+|$)/g
		let consumed = 0
		let match: RegExpExecArray | null
		while ((match = boundary.exec(unspoken)) !== null) {
			const end = match.index + match[0].length
			// Don't cut on abbreviations/decimals: require a few words of content.
			if (end - consumed >= 12 || action.complete) {
				this.enqueueSentence(unspoken.slice(consumed, end))
				consumed = end
			}
		}

		if (action.complete) {
			this.enqueueSentence(unspoken.slice(consumed))
			this.msgSpokenChars = 0
			this.msgLastText = ''
		} else {
			this.msgSpokenChars += consumed
		}
	}

	private enqueueSentence(fragment: string) {
		const clean = stripMarkdown(fragment)
		if (!clean) return
		const settings = getVoiceSettings()
		this.sentencesQueued++
		this.tts.enqueue(clean, { voice: settings.openaiVoice, rate: settings.rate })
	}

	private releaseGate() {
		const waiters = this.gateWaiters
		this.gateWaiters = []
		for (const w of waiters) w()
	}

	private resetGate() {
		this.sentencesQueued = 0
		this.sentencesStarted = 0
		this.releaseGate()
	}

	private refreshStatus() {
		if (this.disposed) return
		let next: VoiceStatus = 'idle'
		if (this.stt) next = 'listening'
		else if (this.tts.isSpeaking()) next = 'speaking'
		else if (this.agent.requests.isGenerating()) next = 'thinking'
		if (this.$status.get() !== next) {
			this.lastStatus = this.$status.get()
			this.$status.set(next)
		}
	}

	isListening() {
		return this.stt !== null
	}

	/** Openers spoken instantly while the model is still thinking. */
	private static OPENERS = [
		'Alright, let me draw this out.',
		'Good question. Let me sketch it.',
		'Okay, let us put this on the board.',
		'Sure. Watch the board.',
		'Let me show you.',
	]
	private nextOpener = Math.floor(Math.random() * VoiceController.OPENERS.length)

	/** Start the microphone. Any speech in progress is cut off (barge-in). */
	async startListening() {
		if (this.stt || this.disposed) return
		this.$error.set(null)
		this.tts.cancel()
		this.resetGate()
		this.$interim.set('')

		// Warm up the opener audio so it can play the instant you stop talking.
		if (voiceSettings.speak.get()) {
			prefetchTts(
				VoiceController.OPENERS[this.nextOpener],
				voiceSettings.openaiVoice.get()
			)?.catch(() => {})
		}
		const engine = voiceSettings.sttEngine.get()
		const stt = createStt(engine, {
			onInterim: (text) => this.$interim.set(text),
			onFinal: (text) => this.submit(text),
			onError: (message) => this.$error.set(message),
			onEnd: () => {
				if (this.stt === stt) this.stt = null
				this.$interim.set('')
				this.refreshStatus()
			},
		})
		this.stt = stt
		this.refreshStatus()
		await stt.start()
	}

	/** Stop the microphone and send whatever was heard. */
	stopListening() {
		this.stt?.stop()
	}

	/** Stop the microphone and throw away what was heard. */
	abortListening() {
		this.stt?.abort()
		this.stt = null
		this.$interim.set('')
		this.refreshStatus()
	}

	toggleListening() {
		if (this.stt) this.stopListening()
		else void this.startListening()
	}

	/** Cut the tutor off mid-sentence and cancel the current request. */
	stopEverything() {
		this.tts.cancel()
		this.abortListening()
		this.agent.cancel()
		this.resetGate()
	}

	/** Send a transcript to the agent as if it had been typed. */
	async submit(text: string) {
		const message = text.trim()
		if (!message) return

		// Any links in the message are read by the worker and shown to the model.
		// Resolve them first: the agent clones the request and can't clone promises.
		const linkPromises = fetchLinksForPrompt(message)
		let data: JsonValue[] = []
		if (linkPromises.length > 0) {
			this.$interim.set('Reading link…')
			data = await Promise.all(linkPromises)
			this.$interim.set('')
		}
		if (this.disposed) return

		this.agent.interrupt({
			input: {
				agentMessages: [message],
				userMessages: [message],
				bounds: this.agent.editor.getViewportPageBounds(),
				source: 'user',
				contextItems: this.agent.context.getItems(),
				data,
			},
		})

		// Fill the model's thinking time with a short spoken acknowledgment.
		// After the interrupt, so the new-prompt cancel doesn't wipe it.
		if (voiceSettings.speak.get()) {
			const opener = VoiceController.OPENERS[this.nextOpener]
			this.nextOpener = (this.nextOpener + 1) % VoiceController.OPENERS.length
			this.enqueueSentence(opener)
		}
	}

	/** Speak an arbitrary line (used for the test button). */
	say(text: string) {
		const settings = getVoiceSettings()
		this.tts.enqueue(text, {
			voice: settings.openaiVoice,
			rate: settings.rate,
		})
	}

	dispose() {
		this.disposed = true
		this.abortListening()
		this.tts.cancel()
		this.releaseGate()
		for (const d of this.disposers) d()
		this.disposers = []
	}
}

/** Text-to-speech reads punctuation literally, so strip the common markdown. */
function stripMarkdown(text: string) {
	return text
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/`([^`]*)`/g, '$1')
		.replace(/\*\*([^*]*)\*\*/g, '$1')
		.replace(/\*([^*]*)\*/g, '$1')
		.replace(/^#+\s*/gm, '')
		.replace(/^\s*[-*]\s+/gm, '')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/->/g, ' to ')
		.replace(/\s+/g, ' ')
		.trim()
}
