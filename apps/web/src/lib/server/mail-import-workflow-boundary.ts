import { Effect } from 'effect'

export type MailImportStepOutcome<A> =
  | { readonly _tag: 'Success'; readonly value: A }
  | { readonly _tag: 'Failure'; readonly message: string }

/** Keeps Workflow checkpoints useful without serializing defects or private data. */
export const mailImportWorkflowErrorMessage = (error: unknown): string => {
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message.length > 0
  ) {
    return error.message.slice(0, 500)
  }
  return 'Gmail import could not complete this step.'
}

/** Converts expected Effect failures into a small serializable step outcome. */
export const mailImportCheckpointOutcome = <A, E>(
  effect: Effect.Effect<A, E>,
): Effect.Effect<MailImportStepOutcome<A>> =>
  effect.pipe(
    Effect.match({
      onFailure: (error): MailImportStepOutcome<A> => ({
        _tag: 'Failure',
        message: mailImportWorkflowErrorMessage(error),
      }),
      onSuccess: (value): MailImportStepOutcome<A> => ({
        _tag: 'Success',
        value,
      }),
    }),
  )

/**
 * Surfaces retryable Postgres failures as defects so `step.do` applies its
 * platform retry policy. Decode failures stay typed because repeating a query
 * cannot repair an invalid persisted shape.
 */
export const retryMailImportPersistenceAtWorkflowBoundary = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  effect.pipe(
    Effect.catchIf(
      (error) =>
        typeof error === 'object' &&
        error !== null &&
        '_tag' in error &&
        error._tag === 'MailRepositoryPersistenceError' &&
        'reason' in error &&
        error.reason !== 'decode',
      (error) => Effect.die(error),
    ),
  )
