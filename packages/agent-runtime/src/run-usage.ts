import type { StepContext } from '@cloudflare/think'

export type RunUsageSnapshot = {
  input_tokens: number
  output_tokens: number
  cached_input_tokens: number
  reasoning_tokens?: number
  total_tokens: number
  model: string
  model_provider: string
  step_count: number
  recorded_at_ms: number
}

export function emptyRunUsage(ctx: StepContext): RunUsageSnapshot {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cached_input_tokens: 0,
    total_tokens: 0,
    model: ctx.model.modelId,
    model_provider: ctx.model.provider,
    step_count: 0,
    recorded_at_ms: Date.now(),
  }
}

export function addStepUsage(
  current: RunUsageSnapshot | null,
  ctx: StepContext,
) {
  const nextUsage = current ?? emptyRunUsage(ctx)
  const inputTokens = ctx.usage.inputTokens ?? 0
  const outputTokens = ctx.usage.outputTokens ?? 0
  const cachedInputTokens =
    ctx.usage.inputTokenDetails?.cacheReadTokens ??
    ctx.usage.cachedInputTokens ??
    0
  const reasoningTokens =
    ctx.usage.outputTokenDetails?.reasoningTokens ??
    ctx.usage.reasoningTokens ??
    0
  const stepTotal = ctx.usage.totalTokens ?? inputTokens + outputTokens

  nextUsage.input_tokens += inputTokens
  nextUsage.output_tokens += outputTokens
  nextUsage.cached_input_tokens += cachedInputTokens
  nextUsage.total_tokens = Math.max(
    nextUsage.total_tokens + stepTotal,
    nextUsage.input_tokens + nextUsage.output_tokens,
  )
  if (reasoningTokens > 0) {
    nextUsage.reasoning_tokens =
      (nextUsage.reasoning_tokens ?? 0) + reasoningTokens
  }
  nextUsage.step_count += 1
  nextUsage.recorded_at_ms = Date.now()
  nextUsage.model = ctx.model.modelId
  nextUsage.model_provider = ctx.model.provider

  return nextUsage
}

export function normalizeRunUsage<T extends RunUsageSnapshot>(usage: T): T {
  return {
    ...usage,
    total_tokens: Math.max(
      usage.total_tokens,
      usage.input_tokens + usage.output_tokens,
    ),
    recorded_at_ms: Date.now(),
  }
}
