import { atom, Atom, react } from 'tldraw'

export type SttEngine = 'browser' | 'openai'

/**
 * User-facing voice settings. Persisted to localStorage so they survive reloads.
 *
 * Defaults: the browser's own (free) speech recognition for ears, and OpenAI's
 * gpt-4o-mini-tts (about $0.015/min, needs OPENAI_API_KEY on the worker) for
 * the voice. There is no browser voice. OpenAI ears (about $0.003/min) are opt-in.
 */
export interface VoiceSettingsValues {
	/** Use the lean, voice-first `tutor` agent mode (no screenshots). */
	tutorMode: boolean
	/** Speak `message` actions aloud. */
	speak: boolean
	/** Which speech-to-text engine to use. */
	sttEngine: SttEngine
	/** OpenAI voice id (marin, cedar, alloy, ...). */
	openaiVoice: string
	/** Playback rate. 1 is normal. */
	rate: number
}

const STORAGE_KEY = 'whiteboard-tutor:voice-settings'

const DEFAULTS: VoiceSettingsValues = {
	tutorMode: true,
	speak: true,
	sttEngine: 'browser',
	openaiVoice: 'marin',
	rate: 1,
}

function load(): VoiceSettingsValues {
	try {
		const raw = localStorage.getItem(STORAGE_KEY)
		if (!raw) return DEFAULTS
		return { ...DEFAULTS, ...JSON.parse(raw) }
	} catch {
		return DEFAULTS
	}
}

function makeAtoms(values: VoiceSettingsValues) {
	return {
		tutorMode: atom('voice.tutorMode', values.tutorMode),
		speak: atom('voice.speak', values.speak),
		sttEngine: atom<SttEngine>('voice.sttEngine', values.sttEngine),
		openaiVoice: atom('voice.openaiVoice', values.openaiVoice),
		rate: atom('voice.rate', values.rate),
	} satisfies { [K in keyof VoiceSettingsValues]: Atom<VoiceSettingsValues[K]> }
}

/** Module-level singleton: one set of voice settings per page. */
export const voiceSettings = makeAtoms(load())

/** Read every setting at once (reactive when used inside `useValue` / `react`). */
export function getVoiceSettings(): VoiceSettingsValues {
	return {
		tutorMode: voiceSettings.tutorMode.get(),
		speak: voiceSettings.speak.get(),
		sttEngine: voiceSettings.sttEngine.get(),
		openaiVoice: voiceSettings.openaiVoice.get(),
		rate: voiceSettings.rate.get(),
	}
}

// Persist on every change.
if (typeof window !== 'undefined') {
	react('persist voice settings', () => {
		const values = getVoiceSettings()
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(values))
		} catch {
			// ignore: private mode or storage full
		}
	})
}
