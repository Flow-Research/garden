import { Effect, Schema } from 'effect'
import type { ExecuteResult } from '@executor-js/codemode-core'
import type {
  ExecutionEngine,
  ExecutionResult,
} from '@executor-js/execution/core'
import type * as Cause from 'effect/Cause'

export const MAX_EXECUTOR_OUTPUT_CHARACTERS = 30_000
// Executor puts the result in both text and structured content. Leave room for
// both copies and the MCP envelope below the 120 KiB event-store threshold.
const MAX_RESULT_JSON_BYTES = 56 * 1024
const encoder = new TextEncoder()

function prefixLength(rendered: string, byteBudget: number) {
  const max = Math.min(rendered.length, MAX_EXECUTOR_OUTPUT_CHARACTERS)
  const size = (end: number) =>
    encoder.encode(JSON.stringify(rendered.slice(0, end))).length

  let low = 0
  let high = max
  if (size(max) <= byteBudget) low = max
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (size(mid) <= byteBudget) low = mid
    else high = mid - 1
  }
  // Keep the complete Unicode character when the cut falls within a pair.
  if (low > 0 && (rendered.codePointAt(low - 1) ?? 0) > 0xffff) return low - 1
  return low
}

export class ExecutorOutputEncodingError extends Schema.TaggedError<ExecutorOutputEncodingError>()(
  'ExecutorOutputEncodingError',
  {},
) {}

/**
 * Converts an unknown Executor result into bounded text. Executor v1.5.40
 * truncates its text preview but otherwise retains the full result and logs in
 * MCP structured content; Garden bounds the value before that formatter runs.
 */
export const boundExecutorOutput = Effect.fn('ExecutorOutput.bound')(function* (
  value: unknown,
  byteBudget = MAX_RESULT_JSON_BYTES,
) {
  const rendered = yield* Effect.try({
    try: () => {
      if (typeof value === 'string') return value
      if (value === undefined) return '(no result)'
      return JSON.stringify(value, null, 2) ?? '(no result)'
    },
    catch: () => new ExecutorOutputEncodingError(),
  })
  const length = prefixLength(rendered, byteBudget)
  const truncated = length < rendered.length
  return {
    text: truncated
      ? `${rendered.slice(0, length)}\n... [truncated ${rendered.length - length} chars]`
      : rendered,
    truncated,
    originalCharacters: rendered.length,
  }
})

/** Removes raw result/log fields before Executor's MCP formatter sees them. */
const boundExecuteResult = (
  result: ExecuteResult,
): Effect.Effect<ExecuteResult> =>
  Effect.all({
    result: boundExecutorOutput(
      result.result,
      result.error === undefined
        ? MAX_RESULT_JSON_BYTES
        : MAX_RESULT_JSON_BYTES / 2,
    ),
    error:
      result.error === undefined
        ? Effect.succeed(undefined)
        : boundExecutorOutput(result.error, MAX_RESULT_JSON_BYTES / 2).pipe(
            Effect.map((bounded) => bounded.text),
          ),
  }).pipe(
    Effect.map(({ result: bounded, error }) => ({
      result: bounded.text,
      ...(result.output === undefined ? {} : { output: result.output }),
      ...(error === undefined ? {} : { error }),
      logs: [],
    })),
    Effect.orElseSucceed(() => ({
      result: '(result could not be encoded)',
      ...(result.output === undefined ? {} : { output: result.output }),
      ...(result.error === undefined ? {} : { error: 'Execution failed.' }),
      logs: [],
    })),
  )

/** Keeps paused state intact while bounding every completed execution result. */
const boundExecutionResult = (
  result: ExecutionResult,
): Effect.Effect<ExecutionResult> =>
  result.status === 'paused'
    ? Effect.succeed(result)
    : boundExecuteResult(result.result).pipe(
        Effect.map((bounded) => ({
          status: 'completed' as const,
          result: bounded,
        })),
      )

/**
 * Decorates the public execution engine at Garden's host seam. Execute and
 * resume results are bounded before either MCP text or structured output is
 * constructed, closing the upstream structured-content bypass.
 */
export const boundExecutionEngine = <Error extends Cause.YieldableError>(
  engine: ExecutionEngine<Error>,
): ExecutionEngine<Error> => ({
  execute: (code, options) =>
    engine.execute(code, options).pipe(Effect.flatMap(boundExecuteResult)),
  executeWithPause: (code, options) =>
    engine
      .executeWithPause(code, options)
      .pipe(Effect.flatMap(boundExecutionResult)),
  resume: (executionId, response) =>
    engine
      .resume(executionId, response)
      .pipe(
        Effect.flatMap((result) =>
          result === null ? Effect.succeed(null) : boundExecutionResult(result),
        ),
      ),
  isExecutionSettled: engine.isExecutionSettled,
  getPausedExecution: (executionId) => engine.getPausedExecution(executionId),
  pausedExecutionCount: () => engine.pausedExecutionCount(),
  hasPausedExecutions: () => engine.hasPausedExecutions(),
  getDescription: engine.getDescription,
})
