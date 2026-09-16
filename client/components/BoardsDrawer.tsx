import { useState } from 'react'
import { useValue } from 'tldraw'
import {
	$activeBoardId,
	$boards,
	$folders,
	Board,
	createBoard,
	createFolder,
	deleteBoard,
	deleteFolder,
	moveBoard,
	renameBoard,
	renameFolder,
	setActiveBoard,
} from '../boards/BoardStore'

/**
 * Slide-over that lists every board, grouped by folder.
 * Click a board to open it. Double-click a name to rename it.
 */
export function BoardsDrawer({ onClose }: { onClose: () => void }) {
	const boards = useValue('boards', () => $boards.get(), [])
	const folders = useValue('folders', () => $folders.get(), [])
	const activeId = useValue('activeBoardId', () => $activeBoardId.get(), [])

	const topLevel = boards.filter((b) => b.folderId === null)

	return (
		<div className="boards-drawer" onClick={(e) => e.stopPropagation()}>
			<div className="boards-drawer-header">
				<strong>Boards</strong>
				<div className="boards-drawer-actions">
					<button type="button" onClick={() => createBoard()} title="New board">
						+ Board
					</button>
					<button type="button" onClick={() => createFolder()} title="New folder">
						+ Folder
					</button>
					<button type="button" onClick={onClose} title="Close" className="boards-close">
						×
					</button>
				</div>
			</div>

			<div className="boards-drawer-body">
				{folders.map((folder) => (
					<div key={folder.id} className="boards-folder">
						<div className="boards-folder-row">
							<EditableName
								value={folder.name}
								onChange={(name) => renameFolder(folder.id, name)}
								className="boards-folder-name"
								prefix="📁"
							/>
							<button
								type="button"
								className="boards-mini"
								title="New board in this folder"
								onClick={() => createBoard('Untitled board', folder.id)}
							>
								+
							</button>
							<button
								type="button"
								className="boards-mini"
								title="Delete folder (boards move to top level)"
								onClick={() => {
									if (confirm(`Delete folder "${folder.name}"? Its boards are kept.`))
										deleteFolder(folder.id)
								}}
							>
								🗑
							</button>
						</div>
						{boards
							.filter((b) => b.folderId === folder.id)
							.map((b) => (
								<BoardRow key={b.id} board={b} active={b.id === activeId} folders={folders} />
							))}
					</div>
				))}

				{topLevel.map((b) => (
					<BoardRow key={b.id} board={b} active={b.id === activeId} folders={folders} />
				))}
			</div>
			<div className="boards-drawer-hint">Double-click a name to rename it.</div>
		</div>
	)
}

function BoardRow({
	board,
	active,
	folders,
}: {
	board: Board
	active: boolean
	folders: { id: string; name: string }[]
}) {
	return (
		<div className={`boards-row ${active ? 'active' : ''}`} onClick={() => setActiveBoard(board.id)}>
			<EditableName
				value={board.name}
				onChange={(name) => renameBoard(board.id, name)}
				className="boards-row-name"
				prefix="▢"
			/>
			<select
				className="boards-move"
				title="Move to folder"
				value={board.folderId ?? ''}
				onClick={(e) => e.stopPropagation()}
				onChange={(e) => moveBoard(board.id, e.target.value || null)}
			>
				<option value="">No folder</option>
				{folders.map((f) => (
					<option key={f.id} value={f.id}>
						{f.name}
					</option>
				))}
			</select>
			<button
				type="button"
				className="boards-mini"
				title="Delete board"
				onClick={(e) => {
					e.stopPropagation()
					if (confirm(`Delete board "${board.name}" and its drawing and chat?`)) deleteBoard(board.id)
				}}
			>
				🗑
			</button>
		</div>
	)
}

function EditableName({
	value,
	onChange,
	className,
	prefix,
}: {
	value: string
	onChange: (name: string) => void
	className: string
	prefix: string
}) {
	const [editing, setEditing] = useState(false)
	const [draft, setDraft] = useState(value)

	if (editing) {
		return (
			<input
				className={className + ' editing'}
				autoFocus
				value={draft}
				onClick={(e) => e.stopPropagation()}
				onChange={(e) => setDraft(e.target.value)}
				onBlur={() => {
					setEditing(false)
					onChange(draft)
				}}
				onKeyDown={(e) => {
					if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
					if (e.key === 'Escape') {
						setDraft(value)
						setEditing(false)
					}
				}}
			/>
		)
	}
	return (
		<span
			className={className}
			title="Double-click to rename"
			onDoubleClick={(e) => {
				e.stopPropagation()
				setDraft(value)
				setEditing(true)
			}}
		>
			<span className="boards-prefix">{prefix}</span> {value}
		</span>
	)
}
