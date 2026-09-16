import { IRequest } from 'itty-router'
import { Environment } from '../environment'

/**
 * Text-to-speech proxy.
 *
 * The browser's built-in `speechSynthesis` is free and is the default. This
 * route is the optional upgrade: it calls OpenAI's cheapest TTS model
 * (`gpt-4o-mini-tts`, roughly $0.015 per minute of audio) and streams the
 * MP3 straight back to the browser. The API key never leaves the worker.
 */
export async function tts(request: IRequest, env: Environment) {
	if (!env.OPENAI_API_KEY) {
		return new Response('OPENAI_API_KEY is not set on the worker', { status: 503 })
	}

	const body = (await request.json()) as { text?: string; voice?: string; instructions?: string }
	const text = (body.text ?? '').trim()
	if (!text) return new Response('Missing text', { status: 400 })
	if (text.length > 4000) return new Response('Text too long', { status: 413 })

	const upstream = await fetch('https://api.openai.com/v1/audio/speech', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${env.OPENAI_API_KEY}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			model: 'gpt-4o-mini-tts',
			voice: body.voice ?? 'marin',
			input: text,
			instructions:
				body.instructions ?? 'Speak like a friendly, patient tutor explaining at a whiteboard.',
			response_format: 'mp3',
		}),
	})

	if (!upstream.ok) {
		const message = await upstream.text()
		return new Response(`TTS failed: ${message}`, { status: upstream.status })
	}

	return new Response(upstream.body, {
		headers: {
			'Content-Type': 'audio/mpeg',
			'Cache-Control': 'no-store',
		},
	})
}
