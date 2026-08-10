import {
  InternetMessageId,
  ProviderObjectId,
  Sha256,
  StorageKey,
  ThreadKey,
  WorkspaceId,
} from '@garden/core/mail'
import { Effect, Schema } from 'effect'

/** Web Crypto failed while deriving a provider-neutral content identity. */
export class MailContentHashError extends Schema.TaggedErrorClass<MailContentHashError>()(
  'MailContentHashError',
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

/** Encodes digest bytes as stable lowercase hexadecimal. */
const hexadecimal = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

/**
 * Hashes exact bytes through the Worker-compatible Web Crypto boundary. Raw
 * message identity deliberately excludes the SMTP envelope so the same RFC
 * message delivered to multiple Garden addresses converges on one message.
 */
export const sha256 = Effect.fn('MailContentAddressing.sha256')(function* (
  content: Uint8Array,
) {
  const digest = yield* Effect.tryPromise({
    try: () => crypto.subtle.digest('SHA-256', content),
    catch: (cause) =>
      new MailContentHashError({
        operation: 'sha256',
        message: 'Mail content identity could not be computed.',
        cause,
      }),
  })

  return Sha256.make(hexadecimal(new Uint8Array(digest)))
})

/** Cloudflare ingress has no event id, so exact raw content is its idempotency id. */
export const inboundProviderMessageId = (
  contentHash: Sha256,
): ProviderObjectId => ProviderObjectId.make(contentHash)

/** Raw MIME objects remain tenant-namespaced even though hashes are global. */
export const rawMailStorageKey = (
  workspaceId: WorkspaceId,
  contentHash: Sha256,
): StorageKey => StorageKey.make(`mail/${workspaceId}/raw/${contentHash}.eml`)

/** Attachment objects are content-addressed for safe workspace-local reuse. */
export const attachmentStorageKey = (
  workspaceId: WorkspaceId,
  contentHash: Sha256,
): StorageKey =>
  StorageKey.make(`mail/${workspaceId}/attachments/${contentHash}`)

export interface ThreadIdentityInput {
  readonly internetMessageId: InternetMessageId | null
  readonly inReplyToMessageId: InternetMessageId | null
  readonly referenceMessageIds: ReadonlyArray<InternetMessageId>
  readonly providerMessageId: ProviderObjectId
}

/**
 * Uses the oldest RFC reference as the stable root. A reply without References
 * falls back to In-Reply-To; a new message uses its own Message-ID. Content
 * identity is the last resort for malformed mail without threading headers.
 */
export const mailThreadKey = (input: ThreadIdentityInput): ThreadKey =>
  ThreadKey.make(
    input.referenceMessageIds[0] ??
      input.inReplyToMessageId ??
      input.internetMessageId ??
      input.providerMessageId,
  )

/** Normalizes conventional reply/forward prefixes for list grouping and search. */
export const normalizedMailSubject = (subject: string): string => {
  let normalized = subject.trim()
  let previous = ''

  while (normalized !== previous) {
    previous = normalized
    normalized = normalized.replace(/^\s*(?:re|fw|fwd)\s*:\s*/i, '')
  }

  return normalized.replace(/\s+/g, ' ').toLocaleLowerCase()
}
