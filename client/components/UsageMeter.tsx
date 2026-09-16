import { useValue } from 'tldraw'
import { useAgent } from '../agent/TldrawAgentAppProvider'

function fmt(n: number) {
	if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
	if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k'
	return String(n)
}

/**
 * Running token and cost meter for this chat.
 * Cost is a list-price estimate and only shown for models with known pricing.
 */
export function UsageMeter() {
	const agent = useAgent()
	const totals = useValue('usageTotals', () => agent.usage.getTotals(), [agent])
	const last = useValue('usageLast', () => agent.usage.getLast(), [agent])

	if (totals.requests === 0) return null

	const cacheHit =
		totals.inputTokens > 0 ? Math.round((100 * totals.cachedInputTokens) / totals.inputTokens) : 0

	return (
		<div
			className="usage-meter"
			title={
				last
					? `Last request: ${fmt(last.inputTokens)} in (${fmt(last.cachedInputTokens)} cached), ${fmt(last.outputTokens)} out`
					: ''
			}
		>
			<span>{totals.requests} req</span>
			<span>{fmt(totals.inputTokens)} in</span>
			<span>{fmt(totals.outputTokens)} out</span>
			<span>{cacheHit}% cached</span>
			<span className="usage-cost">
				{totals.estimatedUsd === null ? 'cost n/a' : `≈ $${totals.estimatedUsd.toFixed(4)}`}
			</span>
		</div>
	)
}
