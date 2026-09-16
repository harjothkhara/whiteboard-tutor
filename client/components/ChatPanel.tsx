import { FormEventHandler, useCallback, useRef, useState } from 'react'
import { useValue } from 'tldraw'
import { getActiveBoard } from '../boards/BoardStore'
import { BoardsDrawer } from './BoardsDrawer'
import { useAgent } from '../agent/TldrawAgentAppProvider'
import { ChatHistory } from './chat-history/ChatHistory'
import { ChatInput } from './ChatInput'
import { TodoList } from './TodoList'
import { UsageMeter } from './UsageMeter'
import { VoiceBar } from './VoiceBar'

export function ChatPanel() {
	const agent = useAgent()
	const inputRef = useRef<HTMLTextAreaElement>(null)

	const handleSubmit = useCallback<FormEventHandler<HTMLFormElement>>(
		async (e) => {
			e.preventDefault()
			if (!inputRef.current) return
			const formData = new FormData(e.currentTarget)
			const value = formData.get('input') as string

			// If the user's message is empty, just cancel the current request (if there is one)
			if (value === '') {
				agent.cancel()
				return
			}

			// Clear the chat input (context is cleared after it's captured in requestAgentActions)
			inputRef.current.value = ''

			// Sending a new message to the agent should interrupt the current request
			agent.interrupt({
				input: {
					agentMessages: [value],
					bounds: agent.editor.getViewportPageBounds(),
					source: 'user',
					contextItems: agent.context.getItems(),
				},
			})
		},
		[agent]
	)

	const handleNewChat = useCallback(() => {
		agent.reset()
	}, [agent])

	const [showBoards, setShowBoards] = useState(false)
	const boardName = useValue('boardName', () => getActiveBoard().name, [])

	return (
		<div className="chat-panel tl-theme__dark">
			<div className="chat-header">
				<button
					className="boards-toggle"
					onClick={() => setShowBoards((v) => !v)}
					title="Boards"
					aria-label="Open boards"
				>
					☰
				</button>
				<span className="chat-title" title={boardName}>
					{boardName}
				</span>
				<UsageMeter />
				<button className="new-chat-button" onClick={handleNewChat} title="New chat (clears this board's chat)">
					+
				</button>
			</div>
			{showBoards && (
				<div className="boards-backdrop" onClick={() => setShowBoards(false)}>
					<BoardsDrawer onClose={() => setShowBoards(false)} />
				</div>
			)}
			<ChatHistory agent={agent} />
			<div className="chat-input-container">
				<TodoList agent={agent} />
				<VoiceBar />
				<ChatInput handleSubmit={handleSubmit} inputRef={inputRef} />
			</div>
		</div>
	)
}
