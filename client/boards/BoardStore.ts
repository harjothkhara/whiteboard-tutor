import { atom, react } from 'tldraw'

/**
 * Multiple named whiteboards, optionally grouped into folders.
 *
 * Each board has its own tldraw persistence key (the canvas) and its own agent
 * state (chat history, todos, usage), both kept in localStorage. Switching
 * boards remounts the editor with the other key.
 */

export interface Board {
	id: string
	name: string
	/** Folder id, or null for the top level. */
	folderId: string | null
	/** Key used for tldraw's local persistence and for the agent state. */
	persistenceKey: string
	createdAt: number
	updatedAt: number
}

export interface Folder {
	id: string
	name: string
	createdAt: number
}

interface BoardIndex {
	boards: Board[]
	folders: Folder[]
	activeBoardId: string
}

const STORAGE_KEY = 'whiteboard-tutor:boards'

/**
 * The key the app used before boards existed. The first board keeps it so
 * nothing you drew before this feature is lost.
 */
export const LEGACY_BOARD_KEY = 'tldraw-agent-demo'

function newId() {
	return crypto.randomUUID().replace(/-/g, '').slice(0, 12)
}

function makeBoard(name: string, folderId: string | null, persistenceKey?: string): Board {
	const id = newId()
	const now = Date.now()
	return {
		id,
		name,
		folderId,
		persistenceKey: persistenceKey ?? `wt-board-${id}`,
		createdAt: now,
		updatedAt: now,
	}
}

function load(): BoardIndex {
	try {
		const raw = localStorage.getItem(STORAGE_KEY)
		if (raw) {
			const parsed = JSON.parse(raw) as BoardIndex
			if (parsed.boards?.length && parsed.activeBoardId) return parsed
		}
	} catch {
		// fall through
	}
	const first = makeBoard('My first board', null, LEGACY_BOARD_KEY)
	return { boards: [first], folders: [], activeBoardId: first.id }
}

const initial = load()

export const $boards = atom<Board[]>('boards', initial.boards)
export const $folders = atom<Folder[]>('folders', initial.folders)
export const $activeBoardId = atom<string>('activeBoardId', initial.activeBoardId)

if (typeof window !== 'undefined') {
	react('persist boards', () => {
		const value: BoardIndex = {
			boards: $boards.get(),
			folders: $folders.get(),
			activeBoardId: $activeBoardId.get(),
		}
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
		} catch {
			// ignore
		}
	})
}

export function getActiveBoard(): Board {
	const id = $activeBoardId.get()
	const boards = $boards.get()
	return boards.find((b) => b.id === id) ?? boards[0]
}

export function setActiveBoard(id: string) {
	if ($boards.get().some((b) => b.id === id)) $activeBoardId.set(id)
}

export function createBoard(name = 'Untitled board', folderId: string | null = null): Board {
	const board = makeBoard(name, folderId)
	$boards.update((list) => [...list, board])
	$activeBoardId.set(board.id)
	return board
}

export function renameBoard(id: string, name: string) {
	const clean = name.trim()
	if (!clean) return
	$boards.update((list) =>
		list.map((b) => (b.id === id ? { ...b, name: clean, updatedAt: Date.now() } : b))
	)
}

export function moveBoard(id: string, folderId: string | null) {
	$boards.update((list) =>
		list.map((b) => (b.id === id ? { ...b, folderId, updatedAt: Date.now() } : b))
	)
}

export function touchBoard(id: string) {
	$boards.update((list) => list.map((b) => (b.id === id ? { ...b, updatedAt: Date.now() } : b)))
}

/** Delete a board and its saved canvas and chat. The last board can't be deleted. */
export function deleteBoard(id: string) {
	const boards = $boards.get()
	if (boards.length <= 1) return
	const board = boards.find((b) => b.id === id)
	if (!board) return
	const remaining = boards.filter((b) => b.id !== id)
	$boards.set(remaining)
	if ($activeBoardId.get() === id) $activeBoardId.set(remaining[0].id)
	clearBoardStorage(board.persistenceKey)
}

export function createFolder(name = 'New folder'): Folder {
	const folder: Folder = { id: newId(), name: name.trim() || 'New folder', createdAt: Date.now() }
	$folders.update((list) => [...list, folder])
	return folder
}

export function renameFolder(id: string, name: string) {
	const clean = name.trim()
	if (!clean) return
	$folders.update((list) => list.map((f) => (f.id === id ? { ...f, name: clean } : f)))
}

/** Delete a folder. Its boards move to the top level. */
export function deleteFolder(id: string) {
	$folders.update((list) => list.filter((f) => f.id !== id))
	$boards.update((list) => list.map((b) => (b.folderId === id ? { ...b, folderId: null } : b)))
}

/** Remove everything tldraw and the agent saved under a board's key. */
function clearBoardStorage(persistenceKey: string) {
	try {
		localStorage.removeItem(`tldraw-agent-app:${persistenceKey}:state`)
		// tldraw keeps the canvas in IndexedDB under a database named after the key.
		indexedDB.deleteDatabase(`TLDRAW_DOCUMENT_v2${persistenceKey}`)
	} catch {
		// ignore
	}
}
