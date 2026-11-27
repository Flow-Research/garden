import { Data } from 'effect'

export type BrainErrorFields = {
  readonly message: string
  readonly cause?: unknown
}

/**
 * Shared Effect error base for the brain. Mirrors the connectors' `ConnectorError`
 * pattern so callers can catch any brain failure by base class while still using
 * `_tag` for precise Effect recovery.
 */
export abstract class BrainError<
  TTag extends string = string,
> extends Data.Error<BrainErrorFields> {
  abstract readonly _tag: TTag
}

export class HelixError extends BrainError<'HelixError'> {
  readonly _tag = 'HelixError' as const
  readonly status?: number
  constructor(fields: BrainErrorFields & { readonly status?: number }) {
    super(fields)
    if (fields.status !== undefined) this.status = fields.status
  }
}

export class WriteConflict extends BrainError<'WriteConflict'> {
  readonly _tag = 'WriteConflict' as const
}

export class EmbedError extends BrainError<'EmbedError'> {
  readonly _tag = 'EmbedError' as const
}

export class ExtractError extends BrainError<'ExtractError'> {
  readonly _tag = 'ExtractError' as const
}
