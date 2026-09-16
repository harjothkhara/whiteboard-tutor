/**
 * Token usage reported by the worker at the end of each model request.
 * Sent as a final `{ usage: AgentUsage }` event on the stream.
 */
export interface AgentUsage {
	modelName: string
	inputTokens: number
	outputTokens: number
	cachedInputTokens: number
	reasoningTokens: number
}

export function isUsageEvent(data: unknown): data is { usage: AgentUsage } {
	return (
		typeof data === 'object' &&
		data !== null &&
		'usage' in data &&
		typeof (data as any).usage === 'object'
	)
}
