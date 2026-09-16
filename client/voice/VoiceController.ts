import { atom, Atom, react } from 'tldraw'
import { ChatHistoryItem } from '../../shared/types/ChatHistoryItem'
import type { TldrawAgent } from '../agent/TldrawAgent'
import { createStt, SttEngineInstance } from './stt'
import { TtsQueue } from './tts'
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
	private spoken = new WeakSet<ChatHistoryItem>()
	private disposers: (() => void)[] = []
	private disposed = false

	constructor(private agent: TldrawAgent) {
		this.$status = atom('voice.status', 'idle')
		this.$interim = atom('voice.interim', '')
		this.$error = atom('voice.error', null)

		// Don't read out history that was already on screen when the page loaded.
		for (const item of agent.chat.getHistory()) this.spoken.add(item)

		// Speak newly completed message actions.
		this.disposers.push(
			react('voice: speak new messages', () => {
				const history = agent.chat.getHistory()
				const settings = getVoiceSettings()
				for (const item of history) {
					if (this.spoken.has(item)) continue
					if (item.type !== 'action') continue
					if (!item.action.complete) continue
					this.spoken.add(item)
					if (!settings.speak) continue
					if (item.action._type !== 'message') continue
					const text = (item.action as { text?: string }).text
					if (text) {
						this.tts.enqueue(stripMarkdown(text), {
							engine: settings.ttsEngine,
							browserVoice: settings.browserVoice,
							openaiVoice: settings.openaiVoice,
							rate: settings.rate,
						})
					}
				}
			})
		)

		// Keep the status atom in sync with the agent and the TTS queue.
		this.disposers.push(
			this.tts.onChange(() => this.refreshStatus()),
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
				}
			})
		)
	}

	private lastStatus: VoiceStatus = 'idle'

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

	/** Start the microphone. Any speech in progress is cut off (barge-in). */
	async startListening() {
		if (this.stt || this.disposed) return
		this.$error.set(null)
		this.tts.cancel()
		this.$interim.set('')
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
	}

	/** Send a transcript to the agent as if it had been typed. */
	submit(text: string) {
		const message = text.trim()
		if (!message) return
		this.agent.interrupt({
			input: {
				agentMessages: [message],
				userMessages: [message],
				bounds: this.agent.editor.getViewportPageBounds(),
				source: 'user',
				contextItems: this.agent.context.getItems(),
			},
		})
	}

	/** Speak an arbitrary line (used for the test button). */
	say(text: string) {
		const settings = getVoiceSettings()
		this.tts.enqueue(text, {
			engine: settings.ttsEngine,
			browserVoice: settings.browserVoice,
			openaiVoice: settings.openaiVoice,
			rate: settings.rate,
		})
	}

	dispose() {
		this.disposed = true
		this.abortListening()
		this.tts.cancel()
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
