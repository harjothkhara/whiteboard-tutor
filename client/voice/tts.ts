/**
 * Text-to-speech with a sequential queue.
 *
 * The only engine is OpenAI's `gpt-4o-mini-tts` (about $0.015 per minute of
 * audio), reached through the worker's `/tts` route. The next clip is fetched
 * while the current one plays so there is no gap between sentences.
 *
 * There is deliberately no browser `speechSynthesis` fallback. If the OpenAI
 * call fails, the error is reported and nothing is spoken.
 */

export interface TtsOptions {
	voice: string
	rate: number
}

interface QueueItem {
	text: string
	options: TtsOptions
	prefetch: Promise<Blob>
}

export class TtsQueue {
	private queue: QueueItem[] = []
	private playing = false
	private currentAudio: HTMLAudioElement | null = null
	private listeners = new Set<(speaking: boolean) => void>()
	private errorListeners = new Set<(message: string) => void>()
	private cancelled = false

	/** Subscribe to speaking/idle changes. Returns an unsubscribe function. */
	onChange(listener: (speaking: boolean) => void) {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}

	/** Subscribe to playback errors. Returns an unsubscribe function. */
	onError(listener: (message: string) => void) {
		this.errorListeners.add(listener)
		return () => this.errorListeners.delete(listener)
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
		const prefetch = fetchOpenAiAudio(clean, options.voice)
		// Errors are handled when the item is played.
		prefetch.catch(() => {})
		this.queue.push({ text: clean, options, prefetch })
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
		this.setPlaying(false)
	}

	private async drain() {
		if (this.playing) return
		this.setPlaying(true)
		try {
			while (this.queue.length > 0 && !this.cancelled) {
				const item = this.queue.shift()!
				try {
					await this.play(item)
				} catch (e: any) {
					const message = e?.message ?? 'Text-to-speech failed'
					console.warn('TTS failed', e)
					for (const l of this.errorListeners) l(message)
				}
			}
		} finally {
			this.setPlaying(false)
		}
	}

	private async play(item: QueueItem) {
		const blob = await item.prefetch
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
	if (!res.ok) {
		const detail = await res.text()
		throw new Error(res.status === 503 ? 'Voice needs OPENAI_API_KEY in .dev.vars' : detail)
	}
	return res.blob()
}
