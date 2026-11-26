import type { StopCondition, ToolSet } from 'ai'
import { Result, TaggedError, type Result as ResultValue } from 'better-result'
import { runUsageSnapshotSchema, type RunUsageSnapshot } from './run-usage'

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

class PersistedRunUsageInvalidError extends TaggedError(
  'PersistedRunUsageInvalidError',
)<{
  issueSummary: string
  message: string
}>() {}

/** Parses persisted usage. Missing data returns `null`; malformed data returns an error. */
export function parsePersistedRunUsage(
  json: unknown,
): ResultValue<RunUsageSnapshot | null, PersistedRunUsageInvalidError> {
  if (json === null || json === undefined) return Result.ok(null)

  const parsed = runUsageSnapshotSchema.safeParse(json)
  if (parsed.success) return Result.ok(parsed.data)

  const issueSummary = parsed.error.issues
    .map((issue) => `${issue.path.join('.') || 'usage_json'}: ${issue.message}`)
    .join('; ')

  return Result.err(
    new PersistedRunUsageInvalidError({
      issueSummary,
      message: `Persisted run usage is invalid: ${issueSummary}`,
    }),
  )
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
