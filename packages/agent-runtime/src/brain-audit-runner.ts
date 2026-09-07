import { Context, Effect, Layer, Schema } from 'effect'
import type { BrainAuditRunInput } from './brain-audit'

type BrainAuditFacet = {
  runAudit(input: BrainAuditRunInput): Promise<{ status: 'completed' }>
}

export class BrainAuditRunError extends Schema.TaggedError<BrainAuditRunError>()(
  'BrainAuditRunError',
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.Defect(),
    agentId: Schema.optional(Schema.String),
  },
) {}

export interface BrainAuditRunnerService {
  readonly run: (
    input: Omit<BrainAuditRunInput, 'agentId'>,
  ) => Effect.Effect<
    { readonly agentId: string; readonly status: 'completed' },
    BrainAuditRunError
  >
}

export class BrainAuditRunner extends Context.Service<
  BrainAuditRunner,
  BrainAuditRunnerService
>()('@garden/agent-runtime/BrainAuditRunner') {}

export type BrainAuditRunnerDependencies = {
  readonly authorize: (workspaceId: string) => Promise<void>
  readonly resolveAgentId: () => Promise<string>
  readonly acquire: (itemId: string) => Promise<BrainAuditFacet>
  readonly release: (itemId: string) => Promise<void>
  readonly onStarted: (input: {
    agentId: string
    itemId: string
    workspaceId: string
  }) => void
  readonly onCleanupFailure: (input: {
    agentId: string
    itemId: string
    workspaceId: string
    cause: unknown
  }) => void
}

/**
 * Owns authorization, facet acquisition, one audit turn, and guaranteed facet
 * reclamation. Agents SDK calls stay receiver-bound in injected closures;
 * cleanup failure is observed without replacing the audit's terminal result.
 */
export const makeBrainAuditRunnerLayer = (
  dependencies: BrainAuditRunnerDependencies,
): Layer.Layer<BrainAuditRunner> => {
  const operation = <A>(
    name: string,
    run: () => Promise<A>,
    agentId?: string,
  ): Effect.Effect<A, BrainAuditRunError> =>
    Effect.tryPromise({
      try: run,
      catch: (cause) =>
        new BrainAuditRunError({
          operation: name,
          message: `Brain audit failed to ${name}.`,
          cause,
          ...(agentId === undefined ? {} : { agentId }),
        }),
    })

  const run = Effect.fn('BrainAuditRunner.run')(function* (
    input: Omit<BrainAuditRunInput, 'agentId'>,
  ) {
    yield* operation('authorize workspace access', () =>
      dependencies.authorize(input.workspaceId),
    )
    const agentId = yield* operation('resolve runtime agent', () =>
      dependencies.resolveAgentId(),
    )
    yield* Effect.sync(() => {
      dependencies.onStarted({
        agentId,
        itemId: input.itemId,
        workspaceId: input.workspaceId,
      })
    })
    const audit = yield* operation(
      'acquire audit facet',
      () => dependencies.acquire(input.itemId),
      agentId,
    )
    const result = yield* operation(
      'run audit turn',
      () => audit.runAudit({ ...input, agentId }),
      agentId,
    ).pipe(
      Effect.ensuring(
        operation(
          'release audit facet',
          () => dependencies.release(input.itemId),
          agentId,
        ).pipe(
          Effect.catch((failure) =>
            Effect.sync(() => {
              dependencies.onCleanupFailure({
                agentId,
                itemId: input.itemId,
                workspaceId: input.workspaceId,
                cause: failure.cause,
              })
            }),
          ),
        ),
      ),
    )
    return { agentId, status: result.status }
  })

  return Layer.succeed(BrainAuditRunner, BrainAuditRunner.of({ run }))
}
