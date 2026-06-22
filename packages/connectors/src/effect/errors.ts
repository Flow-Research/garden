import { Data } from 'effect'

export type ConnectorErrorFields = {
  readonly connectorId: string
  readonly operation: string
  readonly message: string
  readonly cause?: unknown
  readonly status?: number
  readonly retryAfterMs?: number
}

/**
 * Shared Effect error base for provider-native connectors. This exists so the
 * Discord slice starts the Effect migration with one connector error channel
 * instead of isolated per-provider failures; callers can catch every connector
 * failure by base class while still using `_tag` for precise Effect recovery.
 */
export abstract class ConnectorError<
  TTag extends string = string,
> extends Data.Error<ConnectorErrorFields> {
  abstract readonly _tag: TTag
}

/** Marks missing or invalid host/workspace connector configuration. */
export class ConnectorConfigError extends ConnectorError<'ConnectorConfigError'> {
  readonly _tag = 'ConnectorConfigError' as const
}

/** Marks upstream authentication failure or missing credentials. */
export class ConnectorAuthError extends ConnectorError<'ConnectorAuthError'> {
  readonly _tag = 'ConnectorAuthError' as const
}

/** Marks upstream authorization denial for a valid connector identity. */
export class ConnectorPermissionError extends ConnectorError<'ConnectorPermissionError'> {
  readonly _tag = 'ConnectorPermissionError' as const
}

/** Marks provider rate limiting with optional retry timing. */
export class ConnectorRateLimitError extends ConnectorError<'ConnectorRateLimitError'> {
  readonly _tag = 'ConnectorRateLimitError' as const
}

/** Marks a provider object or route that does not exist for this connection. */
export class ConnectorNotFoundError extends ConnectorError<'ConnectorNotFoundError'> {
  readonly _tag = 'ConnectorNotFoundError' as const
}

/** Marks non-specialized upstream HTTP failures. */
export class ConnectorHttpError extends ConnectorError<'ConnectorHttpError'> {
  readonly _tag = 'ConnectorHttpError' as const
}

/** Marks successful HTTP responses whose body did not match the expected shape. */
export class ConnectorDecodeError extends ConnectorError<'ConnectorDecodeError'> {
  readonly _tag = 'ConnectorDecodeError' as const
}
