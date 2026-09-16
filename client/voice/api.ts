/**
 * Small wrapper around fetch for the worker's API routes.
 *
 * Adds the access token (if the deployment requires one) and a per-tab
 * session id so each browser gets its own Durable Object on the worker.
 */

const TOKEN_KEY = 'whiteboard-tutor:access-token'
const SESSION_KEY = 'whiteboard-tutor:session-id'

export function getAccessToken(): string {
	try {
		return localStorage.getItem(TOKEN_KEY) ?? ''
	} catch {
		return ''
	}
}

export function setAccessToken(token: string) {
	try {
		if (token) localStorage.setItem(TOKEN_KEY, token)
		else localStorage.removeItem(TOKEN_KEY)
	} catch {
		// ignore
	}
}

let sessionId = ''
export function getSessionId(): string {
	if (sessionId) return sessionId
	try {
		sessionId = sessionStorage.getItem(SESSION_KEY) ?? ''
	} catch {
		// ignore
	}
	if (!sessionId) {
		sessionId = crypto.randomUUID().replace(/-/g, '')
		try {
			sessionStorage.setItem(SESSION_KEY, sessionId)
		} catch {
			// ignore
		}
	}
	return sessionId
}

export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
	const headers = new Headers(init.headers)
	headers.set('x-session-id', getSessionId())
	const token = getAccessToken()
	if (token) headers.set('Authorization', `Bearer ${token}`)
	return fetch(path, { ...init, headers })
}
