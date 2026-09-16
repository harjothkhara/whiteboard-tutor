import { useEffect, useState } from 'react'
import { useValue } from 'tldraw'
import { useAgent } from '../agent/TldrawAgentAppProvider'
import { runDemoLesson } from '../demo/runDemoLesson'
import { isBrowserSttSupported } from '../voice/stt'
import { getBrowserVoices, isBrowserTtsSupported } from '../voice/tts'
import { VoiceController } from '../voice/VoiceController'
import { voiceSettings } from '../voice/VoiceSettings'

const OPENAI_VOICES = ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse']

/**
 * The voice controls that sit above the chat input: a big mic button, a
 * status line with the live transcript, and a settings drawer.
 */
export function VoiceBar() {
	const agent = useAgent()

	// Created in an effect (not useMemo) so React StrictMode's mount/unmount/mount
	// in dev doesn't leave us holding a disposed controller.
	const [controller, setController] = useState<VoiceController | null>(null)
	useEffect(() => {
		const c = new VoiceController(agent)
		setController(c)
		// Expose for quick manual testing from the devtools console.
		;(window as any).__voice = c
		;(window as any).__agent = agent
		// `?demo` replays a scripted lesson so you can try the experience with no API key.
		let demoTimer: ReturnType<typeof setTimeout> | null = null
		if (new URLSearchParams(window.location.search).has('demo')) {
			demoTimer = setTimeout(() => void runDemoLesson(agent, c), 800)
		}
		return () => {
			if (demoTimer) clearTimeout(demoTimer)
			c.dispose()
		}
	}, [agent])

	if (!controller) return null
	return <VoiceBarInner controller={controller} />
}

function VoiceBarInner({ controller }: { controller: VoiceController }) {

	const status = useValue('voice.status', () => controller.$status.get(), [controller])
	const interim = useValue('voice.interim', () => controller.$interim.get(), [controller])
	const error = useValue('voice.error', () => controller.$error.get(), [controller])
	const handsFree = useValue('voice.handsFree', () => voiceSettings.handsFree.get(), [])
	const [showSettings, setShowSettings] = useState(false)

	// Push-to-talk: hold V while the canvas or panel has focus (not while typing).
	useEffect(() => {
		let held = false
		const isTyping = (e: KeyboardEvent) => {
			const t = e.target as HTMLElement | null
			return !!t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)
		}
		const down = (e: KeyboardEvent) => {
			if (e.key.toLowerCase() !== 'v' || e.repeat || held || isTyping(e)) return
			if (e.metaKey || e.ctrlKey || e.altKey) return
			held = true
			e.preventDefault()
			void controller.startListening()
		}
		const up = (e: KeyboardEvent) => {
			if (e.key.toLowerCase() !== 'v' || !held) return
			held = false
			controller.stopListening()
		}
		window.addEventListener('keydown', down)
		window.addEventListener('keyup', up)
		return () => {
			window.removeEventListener('keydown', down)
			window.removeEventListener('keyup', up)
		}
	}, [controller])

	const label =
		status === 'listening'
			? 'Listening… click to send'
			: status === 'thinking'
				? 'Thinking…'
				: status === 'speaking'
					? 'Speaking… click to interrupt'
					: handsFree
						? 'Hands-free on. Click or hold V to talk'
						: 'Click or hold V to talk'

	return (
		<div className="voice-bar">
			<div className="voice-row">
				<button
					type="button"
					className={`voice-mic voice-mic--${status}`}
					onClick={() => {
						if (status === 'speaking' || status === 'thinking') controller.stopEverything()
						else controller.toggleListening()
					}}
					aria-label={label}
					title={label}
				>
					{status === 'listening' ? '●' : status === 'speaking' ? '■' : status === 'thinking' ? '…' : '🎙'}
				</button>
				<div className="voice-status">
					<div className="voice-status-label">{label}</div>
					{interim && <div className="voice-interim">{interim}</div>}
					{error && <div className="voice-error">{error}</div>}
				</div>
				<button
					type="button"
					className={`voice-settings-toggle ${showSettings ? 'active' : ''}`}
					onClick={() => setShowSettings((v) => !v)}
					title="Voice settings"
				>
					⚙
				</button>
			</div>
			{showSettings && <VoiceSettingsPanel controller={controller} />}
		</div>
	)
}

function VoiceSettingsPanel({ controller }: { controller: VoiceController }) {
	const tutorMode = useValue('voice.tutorMode', () => voiceSettings.tutorMode.get(), [])
	const speak = useValue('voice.speak', () => voiceSettings.speak.get(), [])
	const sttEngine = useValue('voice.sttEngine', () => voiceSettings.sttEngine.get(), [])
	const ttsEngine = useValue('voice.ttsEngine', () => voiceSettings.ttsEngine.get(), [])
	const browserVoice = useValue('voice.browserVoice', () => voiceSettings.browserVoice.get(), [])
	const openaiVoice = useValue('voice.openaiVoice', () => voiceSettings.openaiVoice.get(), [])
	const rate = useValue('voice.rate', () => voiceSettings.rate.get(), [])
	const handsFree = useValue('voice.handsFree', () => voiceSettings.handsFree.get(), [])

	// Browser voices load asynchronously in some browsers.
	const [voices, setVoices] = useState(() => getBrowserVoices())
	useEffect(() => {
		if (!isBrowserTtsSupported()) return
		const update = () => setVoices(getBrowserVoices())
		update()
		window.speechSynthesis.addEventListener('voiceschanged', update)
		return () => window.speechSynthesis.removeEventListener('voiceschanged', update)
	}, [])

	const sttSupported = isBrowserSttSupported()

	return (
		<div className="voice-settings">
			<label>
				<input
					type="checkbox"
					checked={tutorMode}
					onChange={(e) => voiceSettings.tutorMode.set(e.target.checked)}
				/>
				Tutor mode (no screenshots, fewer tokens)
			</label>
			<label>
				<input type="checkbox" checked={speak} onChange={(e) => voiceSettings.speak.set(e.target.checked)} />
				Read replies aloud
			</label>
			<label>
				<input
					type="checkbox"
					checked={handsFree}
					onChange={(e) => voiceSettings.handsFree.set(e.target.checked)}
				/>
				Hands-free (listen again after speaking)
			</label>

			<label className="voice-settings-row">
				<span>Ears</span>
				<select
					value={sttEngine}
					onChange={(e) => voiceSettings.sttEngine.set(e.target.value as 'browser' | 'openai')}
				>
					<option value="browser" disabled={!sttSupported}>
						Browser {sttSupported ? '(free)' : '(not supported here)'}
					</option>
					<option value="openai">OpenAI gpt-4o-mini-transcribe (~$0.003/min)</option>
				</select>
			</label>

			<label className="voice-settings-row">
				<span>Voice</span>
				<select
					value={ttsEngine}
					onChange={(e) => voiceSettings.ttsEngine.set(e.target.value as 'browser' | 'openai')}
				>
					<option value="browser">Browser (free)</option>
					<option value="openai">OpenAI gpt-4o-mini-tts (~$0.015/min)</option>
				</select>
			</label>

			{ttsEngine === 'browser' ? (
				<label className="voice-settings-row">
					<span>Speaker</span>
					<select value={browserVoice} onChange={(e) => voiceSettings.browserVoice.set(e.target.value)}>
						<option value="">System default</option>
						{voices.map((v) => (
							<option key={v.name} value={v.name}>
								{v.name} ({v.lang})
							</option>
						))}
					</select>
				</label>
			) : (
				<label className="voice-settings-row">
					<span>Speaker</span>
					<select value={openaiVoice} onChange={(e) => voiceSettings.openaiVoice.set(e.target.value)}>
						{OPENAI_VOICES.map((v) => (
							<option key={v} value={v}>
								{v}
							</option>
						))}
					</select>
				</label>
			)}

			<label className="voice-settings-row">
				<span>Speed {rate.toFixed(2)}×</span>
				<input
					type="range"
					min={0.7}
					max={1.6}
					step={0.05}
					value={rate}
					onChange={(e) => voiceSettings.rate.set(Number(e.target.value))}
				/>
			</label>

			<button
				type="button"
				className="voice-test"
				onClick={() => controller.say('Hi! I am your whiteboard tutor. Ask me to explain something and I will draw it.')}
			>
				Test voice
			</button>
		</div>
	)
}
