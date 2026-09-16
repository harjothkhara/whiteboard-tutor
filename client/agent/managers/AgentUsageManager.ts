import { Atom, atom } from 'tldraw'
import { getModelPricing, isValidModelName } from '../../../shared/models'
import { AgentUsage } from '../../../shared/types/AgentUsage'
import type { TldrawAgent } from '../TldrawAgent'
import { BaseAgentManager } from './BaseAgentManager'

export interface UsageTotals {
	requests: number
	inputTokens: number
	outputTokens: number
	cachedInputTokens: number
	reasoningTokens: number
	/** Estimated spend in USD. Null when no pricing is known for a model used. */
	estimatedUsd: number | null
}

const EMPTY: UsageTotals = {
	requests: 0,
	inputTokens: 0,
	outputTokens: 0,
	cachedInputTokens: 0,
	reasoningTokens: 0,
	estimatedUsd: 0,
}

/**
 * Tracks token usage across requests so the UI can show a running cost meter.
 * The worker sends a `{ usage }` event at the end of every model request.
 */
export class AgentUsageManager extends BaseAgentManager {
	private $totals: Atom<UsageTotals>
	private $last: Atom<AgentUsage | null>

	constructor(agent: TldrawAgent) {
		super(agent)
		this.$totals = atom('usageTotals', EMPTY)
		this.$last = atom('usageLast', null)
	}

	reset(): void {
		this.$totals.set(EMPTY)
		this.$last.set(null)
	}

	getTotals() {
		return this.$totals.get()
	}

	getLast() {
		return this.$last.get()
	}

	add(usage: AgentUsage) {
		this.$last.set(usage)
		const pricing = isValidModelName(usage.modelName) ? getModelPricing(usage.modelName) : null
		this.$totals.update((t) => {
			// Uncached input is what the provider bills at the full input rate.
			const uncachedInput = Math.max(0, usage.inputTokens - usage.cachedInputTokens)
			let estimatedUsd: number | null = t.estimatedUsd
			if (estimatedUsd !== null) {
				if (pricing) {
					estimatedUsd +=
						(uncachedInput * pricing.inputPerMTok +
							usage.cachedInputTokens * pricing.cachedInputPerMTok +
							usage.outputTokens * pricing.outputPerMTok) /
						1_000_000
				} else {
					estimatedUsd = null
				}
			}
			return {
				requests: t.requests + 1,
				inputTokens: t.inputTokens + usage.inputTokens,
				outputTokens: t.outputTokens + usage.outputTokens,
				cachedInputTokens: t.cachedInputTokens + usage.cachedInputTokens,
				reasoningTokens: t.reasoningTokens + usage.reasoningTokens,
				estimatedUsd,
			}
		})
	}
}
