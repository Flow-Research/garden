import { Duration, Effect, Schema } from 'effect'
import { ConnectorHttpError } from './errors.ts'

/** Upper bound for one provider HTTP round trip. */
export const CONNECTOR_REQUEST_TIMEOUT = Duration.seconds(30)

/**
 * Fails a provider request with a `ConnectorHttpError` when it takes longer
 * than `CONNECTOR_REQUEST_TIMEOUT`. Without a bound, a hung upstream holds the
 * agent's tool call (and its Durable Object turn) open indefinitely.
 */
export const withConnectorTimeout =
  (input: { readonly connectorId: string; readonly operation: string }) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.timeoutOrElse({
        duration: CONNECTOR_REQUEST_TIMEOUT,
        orElse: () =>
          Effect.fail(
            new ConnectorHttpError({
              connectorId: input.connectorId,
              operation: input.operation,
              message: `${input.connectorId} request timed out after ${Duration.toSeconds(CONNECTOR_REQUEST_TIMEOUT)}s.`,
            }),
          ),
      }),
    )

/**
 * An optional integer pagination input bounded to `[1, maximum]`, so a model
 * cannot send fractional or unbounded page sizes to a provider.
 */
export const boundedPageInput = (maximum: number) =>
  Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum })))
