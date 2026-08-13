import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import {
  FormElicitation,
  ToolResult,
  ToolAddress,
  type ElicitationContext,
} from '@executor-js/sdk/core'
import {
  makeApprovalInvocationTracker,
  observeApprovalInvocation,
} from './approval-invocation'

const context = {
  address: ToolAddress.make(
    'google_gmail.user.gmail.gmail.users.threads.modify',
  ),
  args: { id: 'thread-1', removeLabelIds: ['INBOX'] },
  request: FormElicitation.make({
    message: 'Approve archive?',
    requestedSchema: { type: 'object', properties: {} },
  }),
} satisfies ElicitationContext

describe('exact approval invocation tracking', () => {
  it('retains a provider failure even when generated code catches it', async () => {
    const outcomes: unknown[] = []
    const tracker = makeApprovalInvocationTracker((executionId, outcome) =>
      Effect.sync(() => outcomes.push({ executionId, outcome })),
    )
    const exactInvocation = observeApprovalInvocation(
      Effect.fail(new Error('provider rejected')),
      new Set([context]),
      tracker,
    )

    const programResult = await Effect.runPromise(
      Effect.gen(function* () {
        yield* tracker.bind('exec_exact', context)
        return yield* exactInvocation.pipe(
          Effect.catch(() => Effect.succeed('caught by generated code')),
        )
      }),
    )

    expect(programResult).toBe('caught by generated code')
    expect(outcomes).toEqual([
      {
        executionId: 'exec_exact',
        outcome: { status: 'failed' },
      },
    ])
  })

  it('treats an expected provider ToolResult failure as failure', async () => {
    const outcomes: unknown[] = []
    const tracker = makeApprovalInvocationTracker((executionId, outcome) =>
      Effect.sync(() => outcomes.push({ executionId, outcome })),
    )

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* tracker.bind('exec_tool_result', context)
        yield* observeApprovalInvocation(
          Effect.succeed(
            ToolResult.fail({ code: 'provider_rejected', message: 'Rejected' }),
          ),
          new Set([context]),
          tracker,
        )
      }),
    )

    expect(outcomes).toEqual([
      {
        executionId: 'exec_tool_result',
        outcome: { status: 'completed', isError: true },
      },
    ])
  })

  it('ignores a late result after the approval deadline forgot its binding', async () => {
    const outcomes: unknown[] = []
    const tracker = makeApprovalInvocationTracker((executionId, outcome) =>
      Effect.sync(() => outcomes.push({ executionId, outcome })),
    )

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* tracker.bind('exec_expired', context)
        yield* tracker.forget('exec_expired')
        yield* Effect.succeed('late provider result').pipe(
          Effect.onExit((exit) => tracker.complete(new Set([context]), exit)),
        )
      }),
    )

    expect(outcomes).toEqual([])
  })
})
