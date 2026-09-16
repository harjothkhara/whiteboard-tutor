import { atom, Atom, react } from 'tldraw'

export type SttEngine = 'browser' | 'openai'
export type TtsEngine = 'browser' | 'openai'

/**
 * User-facing voice settings. Persisted to localStorage so they survive reloads.
 *
 * Defaults are the free options: the browser's own speech recognition and
 * speech synthesis. The OpenAI options are opt-in upgrades that cost money
 * (roughly $0.003/min to listen and $0.015/min to speak).
 */
export interface VoiceSettingsValues {
	/** Use the lean, voice-first `tutor` agent mode (no screenshots). */
	tutorMode: boolean
	/** Speak `message` actions aloud. */
	speak: boolean
	/** Which speech-to-text engine to use. */
	sttEngine: SttEngine
	/** Which text-to-speech engine to use. */
	ttsEngine: TtsEngine
	/** Browser voice name (speechSynthesis) or OpenAI voice id. */
	browserVoice: string
	openaiVoice: string
	/** Speech rate for browser TTS. 1 is normal. */
	rate: number
	/** After the tutor finishes speaking, automatically start listening again. */
	handsFree: boolean
}

const STORAGE_KEY = 'whiteboard-tutor:voice-settings'

const DEFAULTS: VoiceSettingsValues = {
	tutorMode: true,
	speak: true,
	sttEngine: 'browser',
	ttsEngine: 'browser',
	browserVoice: '',
	openaiVoice: 'marin',
	rate: 1.05,
	handsFree: false,
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
		ttsEngine: atom<TtsEngine>('voice.ttsEngine', values.ttsEngine),
		browserVoice: atom('voice.browserVoice', values.browserVoice),
		openaiVoice: atom('voice.openaiVoice', values.openaiVoice),
		rate: atom('voice.rate', values.rate),
		handsFree: atom('voice.handsFree', values.handsFree),
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
		ttsEngine: voiceSettings.ttsEngine.get(),
		browserVoice: voiceSettings.browserVoice.get(),
		openaiVoice: voiceSettings.openaiVoice.get(),
		rate: voiceSettings.rate.get(),
		handsFree: voiceSettings.handsFree.get(),
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
