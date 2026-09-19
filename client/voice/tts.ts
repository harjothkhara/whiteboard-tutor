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

import { apiFetch } from './api'

export interface TtsOptions {
	voice: string
	rate: number
}

interface QueueItem {
	text: string
	options: TtsOptions
	prefetch: Promise<Blob>
	/** Aborts the in-flight audio fetch so an interrupted sentence isn't billed. */
	abort: AbortController
}

/**
 * Small cache of prefetched audio, used for the instant spoken openers so the
 * tutor can acknowledge you the moment you stop talking. Keyed by voice+text.
 */
const audioCache = new Map<string, Promise<Blob>>()

export function prefetchTts(text: string, voice: string) {
	const key = voice + '|' + text
	if (!audioCache.has(key)) {
		const promise = fetchOpenAiAudio(text, voice, new AbortController().signal)
		promise.catch(() => audioCache.delete(key))
		audioCache.set(key, promise)
		// Keep the cache small.
		if (audioCache.size > 24) {
			const first = audioCache.keys().next().value
			if (first) audioCache.delete(first)
		}
	}
	return audioCache.get(key)!
}

export class TtsQueue {
	private queue: QueueItem[] = []
	private playing = false
	private currentAudio: HTMLAudioElement | null = null
	private current: QueueItem | null = null
	private listeners = new Set<(speaking: boolean) => void>()
	private errorListeners = new Set<(message: string) => void>()
	private startListeners = new Set<(text: string) => void>()
	private cancelled = false

	/** Subscribe to speaking/idle changes. Returns an unsubscribe function. */
	onChange(listener: (speaking: boolean) => void) {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}

	/** Subscribe to the start of each clip (fires even if the clip then fails). */
	onStart(listener: (text: string) => void) {
		this.startListeners.add(listener)
		return () => this.startListeners.delete(listener)
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
		const abort = new AbortController()
		const cached = audioCache.get(options.voice + '|' + clean)
		const prefetch = cached ?? fetchOpenAiAudio(clean, options.voice, abort.signal)
		// Errors are handled when the item is played.
		prefetch.catch(() => {})
		this.queue.push({ text: clean, options, prefetch, abort })
		this.cancelled = false
		void this.drain()
	}

	/** Stop speaking immediately and drop everything queued. */
	cancel() {
		this.cancelled = true
		for (const item of this.queue) item.abort.abort()
		this.queue = []
		this.current?.abort.abort()
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
				this.current = item
				try {
					const blob = await item.prefetch
					if (this.cancelled) continue
					for (const l of this.startListeners) l(item.text)
					await this.playBlob(item, blob)
				} catch (e: any) {
					if (e?.name === 'AbortError' || this.cancelled) continue
					// Count it as started so anything waiting on this sentence isn't stuck.
					for (const l of this.startListeners) l(item.text)
					const message = e?.message ?? 'Text-to-speech failed'
					console.warn('TTS failed', e)
					for (const l of this.errorListeners) l(message)
				} finally {
					this.current = null
				}
			}
		} finally {
			this.setPlaying(false)
		}
	}

	private async playBlob(item: QueueItem, blob: Blob) {
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

async function fetchOpenAiAudio(text: string, voice: string, signal: AbortSignal): Promise<Blob> {
	const res = await apiFetch('/tts', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ text, voice }),
		signal,
	})
	if (!res.ok) {
		throw new Error(friendlyTtsError(res.status, await res.text()))
	}
	return res.blob()
}

/** Turn the raw OpenAI error into one line a person can act on. */
function friendlyTtsError(status: number, body: string): string {
	if (status === 503) return 'No voice: add OPENAI_API_KEY to .dev.vars.'
	if (status === 401) return 'No voice: the server wants an access token (gear icon).'
	if (/insufficient_quota|credit_balance_exhausted/.test(body)) {
		return 'No voice: your OpenAI API account has no credit. Top up at platform.openai.com/settings/organization/billing.'
	}
	if (/invalid_api_key|Incorrect API key/.test(body)) return 'No voice: the OpenAI key is invalid.'
	if (status === 429) return 'No voice: OpenAI rate limit hit, try again in a moment.'
	return `No voice: ${body.slice(0, 160)}`
}
