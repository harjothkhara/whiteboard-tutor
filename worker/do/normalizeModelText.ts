/**
 * Coerce whatever the model wrote into the JSON text the action parser expects.
 *
 * Models usually answer with `{"actions": [...]}` as asked. On follow-up turns
 * they sometimes slip into the notation the chat history uses to *show* past
 * actions, i.e. prose paragraphs with `[ACTION]: {...}` lines. Rather than drop
 * the whole reply, turn prose into `message` actions and the `[ACTION]` lines
 * into real actions. Works on partial (still-streaming) text: the result may be
 * an unterminated JSON prefix, which `closeAndParseJson` knows how to close.
 */
export function normalizeModelText(raw: string): string {
	let text = raw.replace(/^\s+/, '')

	// Strip a leading markdown code fence.
	if (text.startsWith('```')) {
		text = text.replace(/^```[a-zA-Z]*\s*/, '')
	}
	// Strip a trailing fence, complete or partial.
	text = text.replace(/\s*`{1,3}\s*$/, '')

	if (text.startsWith('{') || text.startsWith('[')) return text

	// Prose fallback.
	const items: string[] = []
	let paragraph: string[] = []

	const flushParagraph = () => {
		const joined = paragraph.join(' ').trim()
		paragraph = []
		if (joined) items.push(JSON.stringify({ _type: 'message', text: joined }))
	}

	for (const line of text.split('\n')) {
		const trimmed = line.trim()
		const actionMatch = trimmed.match(/^\[?ACTION\]?\s*:\s*(\{.*)$/)
		if (actionMatch) {
			flushParagraph()
			items.push(actionMatch[1])
			continue
		}
		if (trimmed === '') {
			flushParagraph()
			continue
		}
		paragraph.push(trimmed)
	}
	flushParagraph()

	return '{"actions":[' + items.join(',')
}
