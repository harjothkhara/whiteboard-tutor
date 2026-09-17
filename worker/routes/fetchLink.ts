import { IRequest } from 'itty-router'
import { Environment } from '../environment'

/**
 * Read a link for the tutor.
 *
 * GitHub pull requests and issues get structured handling through the GitHub
 * API (title, description, changed files, a trimmed diff). Anything else is
 * fetched and reduced to plain text. Output is capped so a link never costs
 * more than a few thousand tokens.
 */

const MAX_TEXT_CHARS = 9000
const MAX_PATCH_CHARS = 6000

export async function fetchLink(request: IRequest, env: Environment) {
	const body = (await request.json()) as { url?: string }
	const raw = (body.url ?? '').trim()

	let url: URL
	try {
		url = new URL(raw)
	} catch {
		return Response.json({ error: 'Not a valid URL' }, { status: 400 })
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		return Response.json({ error: 'Only http(s) links' }, { status: 400 })
	}
	if (isPrivateHost(url.hostname)) {
		return Response.json({ error: 'That host is not allowed' }, { status: 400 })
	}

	try {
		const gh = parseGitHubUrl(url)
		if (gh) return Response.json(await readGitHub(gh, env))
		return Response.json(await readPage(url))
	} catch (e: any) {
		return Response.json({ error: e?.message ?? 'Could not read the link' }, { status: 502 })
	}
}

function isPrivateHost(host: string) {
	const h = host.toLowerCase()
	return (
		h === 'localhost' ||
		h.endsWith('.localhost') ||
		h.endsWith('.local') ||
		h.endsWith('.internal') ||
		/^127\./.test(h) ||
		/^10\./.test(h) ||
		/^192\.168\./.test(h) ||
		/^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
		/^169\.254\./.test(h) ||
		h === '0.0.0.0' ||
		h === '::1' ||
		h.startsWith('[')
	)
}

interface GitHubRef {
	owner: string
	repo: string
	kind: 'pull' | 'issues'
	number: number
}

function parseGitHubUrl(url: URL): GitHubRef | null {
	if (url.hostname !== 'github.com') return null
	const m = url.pathname.match(/^\/([^/]+)\/([^/]+)\/(pull|issues)\/(\d+)/)
	if (!m) return null
	return { owner: m[1], repo: m[2], kind: m[3] as 'pull' | 'issues', number: Number(m[4]) }
}

async function ghGet(path: string, env: Environment) {
	const headers: Record<string, string> = {
		Accept: 'application/vnd.github+json',
		'User-Agent': 'whiteboard-tutor',
	}
	if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`
	const res = await fetch(`https://api.github.com${path}`, { headers })
	if (!res.ok) throw new Error(`GitHub API ${res.status} for ${path}`)
	return res.json() as Promise<any>
}

async function readGitHub(ref: GitHubRef, env: Environment) {
	const base = `/repos/${ref.owner}/${ref.repo}`
	if (ref.kind === 'issues') {
		const issue = await ghGet(`${base}/issues/${ref.number}`, env)
		return {
			source: `github issue ${ref.owner}/${ref.repo}#${ref.number}`,
			title: issue.title,
			state: issue.state,
			author: issue.user?.login,
			labels: (issue.labels ?? []).map((l: any) => l.name),
			text: clip(issue.body ?? '', MAX_TEXT_CHARS),
		}
	}

	const [pr, files] = await Promise.all([
		ghGet(`${base}/pulls/${ref.number}`, env),
		ghGet(`${base}/pulls/${ref.number}/files?per_page=50`, env),
	])

	let patchBudget = MAX_PATCH_CHARS
	const changedFiles = (files as any[]).map((f) => {
		let patch: string | undefined
		if (f.patch && patchBudget > 0) {
			patch = clip(f.patch, Math.min(patchBudget, 2500))
			patchBudget -= patch.length
		}
		return {
			file: f.filename,
			status: f.status,
			additions: f.additions,
			deletions: f.deletions,
			...(patch ? { patch } : {}),
		}
	})

	return {
		source: `github pull request ${ref.owner}/${ref.repo}#${ref.number}`,
		title: pr.title,
		state: pr.merged ? 'merged' : pr.state,
		author: pr.user?.login,
		branch: `${pr.head?.ref} -> ${pr.base?.ref}`,
		changedFiles: pr.changed_files,
		additions: pr.additions,
		deletions: pr.deletions,
		description: clip(pr.body ?? '', MAX_TEXT_CHARS),
		files: changedFiles,
	}
}

async function readPage(url: URL) {
	const res = await fetch(url.toString(), {
		headers: { 'User-Agent': 'whiteboard-tutor', Accept: 'text/html,text/plain,application/json' },
		redirect: 'follow',
	})
	if (!res.ok) throw new Error(`HTTP ${res.status} fetching the page`)
	const type = res.headers.get('content-type') ?? ''
	const body = await res.text()
	const text = type.includes('html') ? htmlToText(body) : body
	const titleMatch = body.match(/<title[^>]*>([^<]*)<\/title>/i)
	return {
		source: url.toString(),
		title: titleMatch ? titleMatch[1].trim() : undefined,
		text: clip(text, MAX_TEXT_CHARS),
	}
}

function htmlToText(html: string) {
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, ' ')
		.replace(/<style[\s\S]*?<\/style>/gi, ' ')
		.replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
		.replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
		.replace(/<(br|p|div|li|h[1-6]|tr)[^>]*>/gi, '\n')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/[ \t]+/g, ' ')
		.replace(/\n\s*\n+/g, '\n')
		.trim()
}

function clip(text: string, max: number) {
	return text.length > max ? text.slice(0, max) + '\n…[truncated]' : text
}
