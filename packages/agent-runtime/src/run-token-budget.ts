import type { StopCondition, ToolSet } from 'ai'
import { z } from 'zod'
import type { RunUsageSnapshot } from './run-usage'

/**
 * Most tokens one run may spend across all of its turns. A per-step output
 * cap does not bound a run with many steps, and each step re-sends the whole
 * context as input, so total tokens grow with step count.
 *
 * Derivation: see "Token budget" in docs/concepts/architecture/run-engine.md.
 */
export const RUN_TOKEN_BUDGET = 2_000_000

/** Failure reason recorded on a run stopped by {@link RUN_TOKEN_BUDGET}. */
export const RUN_TOKEN_BUDGET_EXCEEDED = 'run_token_budget_exceeded'

const persistedRunUsageSchema = z.object({
  input_tokens: z.number(),
  output_tokens: z.number(),
  cached_input_tokens: z.number(),
  reasoning_tokens: z.number().optional(),
  total_tokens: z.number(),
  model: z.string(),
  model_provider: z.string(),
  step_count: z.number(),
  recorded_at_ms: z.number(),
})

/**
 * Reads a run ledger's `usage_json`. A row with no usage yet, or with a
 * different shape, counts as no usage rather than failing the run.
 */
export function parsePersistedRunUsage(json: unknown): RunUsageSnapshot | null {
  const parsed = persistedRunUsageSchema.safeParse(json)
  return parsed.success ? parsed.data : null
}

export function runTokenBudgetReached(
  totalTokens: number,
  budget: number = RUN_TOKEN_BUDGET,
) {
  return totalTokens >= budget
}

/**
 * Stop condition for one turn: true once tokens spent by earlier turns plus
 * this turn's finished steps reach the budget. The AI SDK evaluates stop
 * conditions only when the model asked to continue, so a turn that ends on
 * its own is never cut short.
 */
export function runTokenBudgetStopCondition<TOOLS extends ToolSet>(input: {
  priorTurnTokens: number
  budget?: number
}): StopCondition<TOOLS> {
  return ({ steps }) =>
    runTokenBudgetReached(
      steps.reduce(
        (total, step) =>
          total +
          (step.usage.totalTokens ??
            (step.usage.inputTokens ?? 0) + (step.usage.outputTokens ?? 0)),
        input.priorTurnTokens,
      ),
      input.budget,
    )
}
