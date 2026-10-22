import { Context, Effect, Layer, Schema } from 'effect'
import type { BrainWriteBackRunInput } from './brain-write-back'

type BrainWriteBackFacet = {
  runWriteBack(input: BrainWriteBackRunInput): Promise<{ status: 'completed' }>
}

export class BrainWriteBackRunError extends Schema.TaggedError<BrainWriteBackRunError>()(
  'BrainWriteBackRunError',
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.Defect(),
    agentId: Schema.optional(Schema.String),
  },
) {}

export interface BrainWriteBackRunnerService {
  readonly run: (
    input: Omit<BrainWriteBackRunInput, 'agentId'>,
  ) => Effect.Effect<
    { readonly agentId: string; readonly status: 'completed' },
    BrainWriteBackRunError
  >
}

export class BrainWriteBackRunner extends Context.Service<
  BrainWriteBackRunner,
  BrainWriteBackRunnerService
>()('@garden/agent-runtime/BrainWriteBackRunner') {}

export type BrainWriteBackRunnerDependencies = {
  readonly authorize: (workspaceId: string) => Promise<void>
  readonly resolveAgentId: () => Promise<string>
  readonly acquire: (facetName: string) => Promise<BrainWriteBackFacet>
  readonly release: (facetName: string) => Promise<void>
  readonly onStarted: (input: {
    agentId: string
    runId: string
    workspaceId: string
  }) => void
  readonly onCleanupFailure: (input: {
    agentId: string
    runId: string
    workspaceId: string
    cause: unknown
  }) => void
}

const facetNameOf = (input: Omit<BrainWriteBackRunInput, 'agentId'>): string =>
  `${input.runKind}:${input.runId}`

/**
 * Owns authorization, facet acquisition, one write-back turn, and guaranteed
 * facet reclamation. Mirrors BrainAuditRunner so run memory uses the same
 * one-shot facet contract as static ingestion.
 */
export const makeBrainWriteBackRunnerLayer = (
  dependencies: BrainWriteBackRunnerDependencies,
): Layer.Layer<BrainWriteBackRunner> => {
  const operation = <A>(
    name: string,
    run: () => Promise<A>,
    agentId?: string,
  ): Effect.Effect<A, BrainWriteBackRunError> =>
    Effect.tryPromise({
      try: run,
      catch: (cause) =>
        new BrainWriteBackRunError({
          operation: name,
          message: `Brain write-back failed to ${name}.`,
          cause,
          ...(agentId === undefined ? {} : { agentId }),
        }),
    })

  const run = Effect.fn('BrainWriteBackRunner.run')(function* (
    input: Omit<BrainWriteBackRunInput, 'agentId'>,
  ) {
    yield* operation('authorize workspace access', () =>
      dependencies.authorize(input.workspaceId),
    )
    const agentId = yield* operation('resolve runtime agent', () =>
      dependencies.resolveAgentId(),
    )
    const facetName = facetNameOf(input)
    yield* Effect.sync(() => {
      dependencies.onStarted({
        agentId,
        runId: input.runId,
        workspaceId: input.workspaceId,
      })
    })
    const facet = yield* operation(
      'acquire write-back facet',
      () => dependencies.acquire(facetName),
      agentId,
    )
    const result = yield* operation(
      'run write-back turn',
      () => facet.runWriteBack({ ...input, agentId }),
      agentId,
    ).pipe(
      Effect.ensuring(
        operation(
          'release write-back facet',
          () => dependencies.release(facetName),
          agentId,
        ).pipe(
          Effect.catch((failure) =>
            Effect.sync(() => {
              dependencies.onCleanupFailure({
                agentId,
                runId: input.runId,
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

  return Layer.succeed(BrainWriteBackRunner, BrainWriteBackRunner.of({ run }))
}
