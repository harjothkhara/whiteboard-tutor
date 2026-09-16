import { IRequest } from 'itty-router'
import { Environment } from '../environment'

/**
 * Speech-to-text proxy.
 *
 * The browser's built-in Web Speech API is free and is the default. This route
 * is the optional upgrade for browsers without it (Firefox) or for better
 * accuracy: it forwards a short audio clip to OpenAI's cheapest transcription
 * model (`gpt-4o-mini-transcribe`, roughly $0.003 per minute).
 */
export async function transcribe(request: IRequest, env: Environment) {
	if (!env.OPENAI_API_KEY) {
		return new Response('OPENAI_API_KEY is not set on the worker', { status: 503 })
	}

	const incoming = await request.formData()
	const audio = incoming.get('audio')
	if (!(audio instanceof File)) return new Response('Missing audio', { status: 400 })

	const form = new FormData()
	form.append('file', audio, audio.name || 'clip.webm')
	form.append('model', 'gpt-4o-mini-transcribe')
	form.append('response_format', 'json')

	const upstream = await fetch('https://api.openai.com/v1/audio/transcriptions', {
		method: 'POST',
		headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
		body: form,
	})

	if (!upstream.ok) {
		const message = await upstream.text()
		return new Response(`Transcription failed: ${message}`, { status: upstream.status })
	}

	const result = (await upstream.json()) as { text?: string }
	return Response.json({ text: result.text ?? '' })
}
