import type { MessageConcurrency } from '@cloudflare/think'

/** Matches Think's installed recoverable-submission window (900 seconds). */
export const MAIL_CONTEXT_TOKEN_TTL_MS = 15 * 60 * 1_000

export type MailContextTokenRecord = {
  readonly consumedAt: string | null
  readonly completedAt: string | null
  readonly recoveryPending: boolean
  readonly expiresAt: string
}

export type MailContextTokenUse =
  | { readonly _tag: 'Consume' }
  | { readonly _tag: 'Continue' }
  | { readonly _tag: 'Recover' }
  | {
      readonly _tag: 'Reject'
      readonly reason:
        | 'expired'
        | 'completed'
        | 'already-consumed'
        | 'continuation-not-started'
        | 'recovery-not-started'
    }

/**
 * Defines the one-use capability state machine shared by initial turns,
 * continuations, and recovery. Only one initial turn may atomically consume a
 * token; continuations may reuse that active lease until terminal completion.
 */
export function mailContextTokenUse(
  record: MailContextTokenRecord,
  nowIso: string,
  mode: 'initial' | 'continuation',
): MailContextTokenUse {
  if (record.expiresAt <= nowIso) return { _tag: 'Reject', reason: 'expired' }
  if (record.completedAt !== null) {
    return { _tag: 'Reject', reason: 'completed' }
  }
  if (mode === 'continuation') {
    return record.consumedAt === null
      ? { _tag: 'Reject', reason: 'continuation-not-started' }
      : { _tag: 'Continue' }
  }
  if (record.recoveryPending) {
    return record.consumedAt === null
      ? { _tag: 'Reject', reason: 'recovery-not-started' }
      : { _tag: 'Recover' }
  }
  return record.consumedAt === null
    ? { _tag: 'Consume' }
    : { _tag: 'Reject', reason: 'already-consumed' }
}

/** Preserves ordinary chat merging while hidden Inbox facets reject overlap. */
export const mailMessageConcurrency = (
  inboxRuntime: boolean,
): MessageConcurrency => (inboxRuntime ? 'drop' : 'merge')

/** Reads the durable facet marker written only by server-authorized mail RPC. */
export const isMailRuntime = (storage: DurableObjectStorage): boolean =>
  Array.from(
    storage.sql.exec(
      'select singleton from mail_runtime_config where singleton = 1',
    ),
  ).length > 0

/**
 * Models the recovery-hook handoff without mutating the active token lease.
 * Repeated hooks are idempotent; the first recovered turn atomically clears
 * the marker, so a browser replay cannot claim the same capability.
 */
export function markMailContextRecoveryPending(
  record: MailContextTokenRecord,
  nowIso: string,
): MailContextTokenRecord {
  if (
    record.consumedAt === null ||
    record.completedAt !== null ||
    record.expiresAt <= nowIso
  ) {
    return record
  }
  return { ...record, recoveryPending: true }
}
