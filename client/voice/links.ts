import { JsonValue } from 'tldraw'
import { apiFetch } from './api'

const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi

/** Pull URLs out of a message, stripping trailing punctuation. */
export function extractUrls(message: string): string[] {
	const found = message.match(URL_RE) ?? []
	return Array.from(new Set(found.map((u) => u.replace(/[.,;:!?]+$/, ''))))
}

/**
 * For every link in the message, start a fetch through the worker and return
 * the promises. They ride along in the request's `data` field, which the
 * agent's data prompt part awaits and shows to the model.
 */
export function fetchLinksForPrompt(message: string): Promise<JsonValue>[] {
	return extractUrls(message)
		.slice(0, 3)
		.map(async (url): Promise<JsonValue> => {
			const res = await apiFetch('/fetch', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url }),
			})
			let json: JsonValue
			try {
				json = (await res.json()) as JsonValue
			} catch {
				json = { error: `Could not read ${url}` }
			}
			return { link: url, ...(json as object) } as JsonValue
		})
}
