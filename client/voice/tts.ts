/**
 * Text-to-speech engines with a shared sequential queue.
 *
 * - `browser`: `window.speechSynthesis`. Free, instant, quality depends on OS.
 * - `openai`: posts to the worker's `/tts` route (gpt-4o-mini-tts, about
 *   $0.015 per minute of audio) and plays the MP3. The next clip is fetched
 *   while the current one plays so there is no gap between sentences.
 */

export type TtsEngineName = 'browser' | 'openai'

export interface TtsOptions {
	engine: TtsEngineName
	browserVoice: string
	openaiVoice: string
	rate: number
}

interface QueueItem {
	text: string
	options: TtsOptions
	/** For the OpenAI engine, the audio fetch started ahead of time. */
	prefetch?: Promise<Blob>
}

export function isBrowserTtsSupported() {
	return typeof window !== 'undefined' && 'speechSynthesis' in window
}

export function getBrowserVoices(): SpeechSynthesisVoice[] {
	if (!isBrowserTtsSupported()) return []
	return window.speechSynthesis.getVoices()
}

export class TtsQueue {
	private queue: QueueItem[] = []
	private playing = false
	private currentAudio: HTMLAudioElement | null = null
	private currentUtterance: SpeechSynthesisUtterance | null = null
	private listeners = new Set<(speaking: boolean) => void>()
	private cancelled = false

	/** Subscribe to speaking/idle changes. Returns an unsubscribe function. */
	onChange(listener: (speaking: boolean) => void) {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}

	isSpeaking() {
		return this.playing
	}

	private setPlaying(value: boolean) {
		if (this.playing === value) return
		this.playing = value
		for (const l of this.listeners) l(value)
	}

	enqueue(text: string, options: TtsOptions) {
		const clean = text.trim()
		if (!clean) return
		const item: QueueItem = { text: clean, options }
		if (options.engine === 'openai') {
			item.prefetch = fetchOpenAiAudio(clean, options.openaiVoice)
			// Avoid unhandled-rejection noise; errors are handled when played.
			item.prefetch.catch(() => {})
		}
		this.queue.push(item)
		this.cancelled = false
		void this.drain()
	}

	/** Stop speaking immediately and drop everything queued. */
	cancel() {
		this.cancelled = true
		this.queue = []
		if (this.currentAudio) {
			this.currentAudio.pause()
			this.currentAudio.src = ''
			this.currentAudio = null
		}
		if (isBrowserTtsSupported()) window.speechSynthesis.cancel()
		this.currentUtterance = null
		this.setPlaying(false)
	}

	private async drain() {
		if (this.playing) return
		this.setPlaying(true)
		try {
			while (this.queue.length > 0 && !this.cancelled) {
				const item = this.queue.shift()!
				try {
					if (item.options.engine === 'openai') {
						await this.playOpenAi(item)
					} else {
						await this.playBrowser(item)
					}
				} catch (e) {
					console.warn('TTS failed, falling back to browser voice', e)
					if (item.options.engine === 'openai' && !this.cancelled) {
						await this.playBrowser({ ...item, options: { ...item.options, engine: 'browser' } })
					}
				}
			}
		} finally {
			this.setPlaying(false)
		}
	}

	private playBrowser(item: QueueItem) {
		return new Promise<void>((resolve) => {
			if (!isBrowserTtsSupported()) return resolve()
			const u = new SpeechSynthesisUtterance(item.text)
			u.rate = item.options.rate
			const voice = getBrowserVoices().find((v) => v.name === item.options.browserVoice)
			if (voice) u.voice = voice
			u.onend = () => {
				this.currentUtterance = null
				resolve()
			}
			u.onerror = () => {
				this.currentUtterance = null
				resolve()
			}
			this.currentUtterance = u
			window.speechSynthesis.speak(u)
		})
	}

	private async playOpenAi(item: QueueItem) {
		const blob = await (item.prefetch ?? fetchOpenAiAudio(item.text, item.options.openaiVoice))
		if (this.cancelled) return
		const url = URL.createObjectURL(blob)
		try {
			await new Promise<void>((resolve, reject) => {
				const audio = new Audio(url)
				audio.playbackRate = item.options.rate
				audio.onended = () => resolve()
				audio.onerror = () => reject(new Error('Audio playback failed'))
				this.currentAudio = audio
				audio.play().catch(reject)
			})
		} finally {
			this.currentAudio = null
			URL.revokeObjectURL(url)
		}
	}
}

async function fetchOpenAiAudio(text: string, voice: string): Promise<Blob> {
	const res = await fetch('/tts', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ text, voice }),
	})
	if (!res.ok) throw new Error(await res.text())
	return res.blob()
}
