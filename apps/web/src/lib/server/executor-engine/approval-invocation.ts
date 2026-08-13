import { Effect, Exit } from 'effect'
import { isToolResult, type ElicitationContext } from '@executor-js/sdk/core'
import type { BrowserApprovalOutcome } from '@executor-js/host-mcp/tool-server'

export type ApprovalInvocationTracker = ReturnType<
  typeof makeApprovalInvocationTracker
>

/**
 * Classifies the exact Executor tool invocation that owned an elicitation.
 * This runs before the result crosses back into generated JavaScript, where a
 * program may catch the provider error and continue with an unrelated result.
 */
export const approvalInvocationOutcome = <A, E>(
  exit: Exit.Exit<A, E>,
): BrowserApprovalOutcome => {
  if (Exit.isFailure(exit)) return { status: 'failed' }
  return {
    status: 'completed',
    isError: isToolResult(exit.value) && !exit.value.ok,
  }
}

/**
 * Correlates the in-memory elicitation object retained by ExecutionEngine with
 * the opaque execution id exposed by its paused API. The paused lease keeps
 * this runtime alive; forgetting an expired id makes late provider completion
 * a no-op instead of leaking a stale durable outcome.
 */
export const makeApprovalInvocationTracker = (
  complete: (
    executionId: string,
    outcome: BrowserApprovalOutcome,
  ) => Effect.Effect<void>,
) => {
  const executionIdByContext = new WeakMap<object, string>()
  const contextByExecutionId = new Map<string, ElicitationContext>()

  return {
    bind: Effect.fn('ExecutorApprovalInvocation.bind')(
      (executionId: string, context: ElicitationContext) =>
        Effect.sync(() => {
          const previous = contextByExecutionId.get(executionId)
          if (previous !== undefined && previous !== context) {
            executionIdByContext.delete(previous)
          }
          executionIdByContext.set(context, executionId)
          contextByExecutionId.set(executionId, context)
        }),
    ),
    forget: Effect.fn('ExecutorApprovalInvocation.forget')(
      (executionId: string) =>
        Effect.sync(() => {
          const context = contextByExecutionId.get(executionId)
          if (context !== undefined) executionIdByContext.delete(context)
          contextByExecutionId.delete(executionId)
        }),
    ),
    complete: Effect.fn('ExecutorApprovalInvocation.complete')(function* <A, E>(
      contexts: ReadonlySet<ElicitationContext>,
      exit: Exit.Exit<A, E>,
    ) {
      const outcome = approvalInvocationOutcome(exit)
      const executionIds = new Set<string>()
      for (const context of contexts) {
        const executionId = executionIdByContext.get(context)
        if (executionId === undefined) continue
        executionIdByContext.delete(context)
        contextByExecutionId.delete(executionId)
        executionIds.add(executionId)
      }
      yield* Effect.forEach(
        executionIds,
        (executionId) => complete(executionId, outcome),
        { discard: true },
      )
    }),
  }
}

/** Attaches exact invocation settlement before generated code sees the result. */
export const observeApprovalInvocation = <A, E, R>(
  invocation: Effect.Effect<A, E, R>,
  contexts: ReadonlySet<ElicitationContext>,
  tracker: ApprovalInvocationTracker,
): Effect.Effect<A, E, R> =>
  invocation.pipe(Effect.onExit((exit) => tracker.complete(contexts, exit)))
