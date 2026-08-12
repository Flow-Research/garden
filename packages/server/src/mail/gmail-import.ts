import {
  EmailAddress,
  ImportedMailEnvelope,
  IngestedMail,
  MailSyncAccountId,
  MemberId,
  ProviderEvidence,
  ProviderKey,
  ProviderObjectId,
  UtcTimestamp,
  WorkspaceId,
} from '@garden/core/mail'
import { Context, Effect, Encoding, Layer, Schema } from 'effect'
import {
  attachmentStorageKey,
  rawMailStorageKey,
  sha256,
  type MailContentHashError,
} from './content-addressing.ts'
import { GmailRawMessage } from './gmail-client.ts'
import {
  type MailMimeParseError,
  type MailMimeValidationError,
  parseNormalizedMime,
} from './mime.ts'
import { MailObjectStore, type MailObjectWriteError } from './object-store.ts'
import { MailRepository, type MailRepositoryError } from './repository.ts'

const GMAIL_PROVIDER = ProviderKey.make('gmail')

export const ImportGmailMessageInput = Schema.Struct({
  workspaceId: WorkspaceId,
  syncAccountId: MailSyncAccountId,
  memberId: MemberId,
  providerEmail: EmailAddress,
  message: GmailRawMessage,
})
export interface ImportGmailMessageInput extends Schema.Schema.Type<
  typeof ImportGmailMessageInput
> {}

/** Gmail returned data that cannot safely become canonical RFC mail content. */
export class GmailImportContentError extends Schema.TaggedErrorClass<GmailImportContentError>()(
  'GmailImportContentError',
  {
    providerMessageId: Schema.String,
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export type GmailImportMessageError =
  | GmailImportContentError
  | MailContentHashError
  | MailMimeParseError
  | MailMimeValidationError
  | MailObjectWriteError
  | MailRepositoryError

export interface GmailImportService {
  readonly importMessage: (
    input: ImportGmailMessageInput,
  ) => Effect.Effect<IngestedMail, GmailImportMessageError>
}

/** Imports one Gmail RAW object through Garden's canonical mail boundaries. */
export class GmailImport extends Context.Service<
  GmailImport,
  GmailImportService
>()('@garden/server/GmailImport') {}

/** Gmail internalDate is an epoch-millisecond string, not an RFC date. */
const gmailInternalTimestamp = (
  message: GmailRawMessage,
): Effect.Effect<typeof UtcTimestamp.Type, GmailImportContentError> => {
  const milliseconds = Number(message.internalDate)
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    return Effect.fail(
      new GmailImportContentError({
        providerMessageId: message.id,
        operation: 'decodeInternalDate',
        message: 'Gmail returned an invalid internal message timestamp.',
      }),
    )
  }
  const date = new Date(milliseconds)
  if (Number.isNaN(date.getTime())) {
    return Effect.fail(
      new GmailImportContentError({
        providerMessageId: message.id,
        operation: 'decodeInternalDate',
        message: 'Gmail returned an invalid internal message timestamp.',
      }),
    )
  }
  return Effect.succeed(UtcTimestamp.make(date.toISOString()))
}

/** Decodes Gmail's URL-safe RAW payload without a browser or Node buffer. */
const gmailRawBytes = (
  message: GmailRawMessage,
): Effect.Effect<Uint8Array, GmailImportContentError> =>
  Effect.fromResult(Encoding.decodeBase64Url(message.raw)).pipe(
    Effect.mapError(
      (cause) =>
        new GmailImportContentError({
          providerMessageId: message.id,
          operation: 'decodeRaw',
          message: 'Gmail returned invalid base64url MIME content.',
          cause,
        }),
    ),
  )

/** Provider evidence is diagnostic metadata and never used as canonical MIME. */
const gmailProviderEvidence = (message: GmailRawMessage): ProviderEvidence =>
  ProviderEvidence.make({
    historyId: message.historyId,
    internalDate: message.internalDate,
    labelIds: [...(message.labelIds ?? [])],
    ...(message.sizeEstimate === undefined
      ? {}
      : { sizeEstimate: message.sizeEstimate }),
  })

/**
 * Parses and stores one RAW Gmail object, then atomically projects it into the
 * external read-only mailbox. Gmail ids remain the provider identity while
 * content hashes own R2 paths, so Workflow retries are idempotent at both seams.
 */
export const importGmailRawMessage = Effect.fn('GmailImport.importMessage')(
  function* (input: ImportGmailMessageInput) {
    const repository = yield* MailRepository
    const objectStore = yield* MailObjectStore
    const raw = yield* gmailRawBytes(input.message)
    const internalTimestamp = yield* gmailInternalTimestamp(input.message)
    const parsed = yield* parseNormalizedMime({
      envelopeFrom: input.providerEmail,
      envelopeTo: input.providerEmail,
      headers: [],
      raw,
      rawSize: raw.byteLength,
    })
    const rawHash = yield* sha256(raw)
    const rawStorageKey = rawMailStorageKey(input.workspaceId, rawHash)

    yield* objectStore.put({
      key: rawStorageKey,
      content: raw,
      contentType: 'message/rfc822',
    })

    const attachments = yield* Effect.forEach(
      parsed.attachments,
      (attachment) =>
        Effect.gen(function* () {
          const contentHash = yield* sha256(attachment.content)
          const storageKey = attachmentStorageKey(
            input.workspaceId,
            rawHash,
            contentHash,
            attachment.position,
          )
          yield* objectStore.put({
            key: storageKey,
            content: attachment.content,
            contentType: attachment.contentType,
          })
          return {
            storageKey,
            fileName: attachment.fileName,
            contentType: attachment.contentType,
            sizeBytes: attachment.sizeBytes,
            contentHash,
            disposition: attachment.disposition,
            contentId: attachment.contentId,
            position: attachment.position,
          }
        }),
    )

    const envelope = ImportedMailEnvelope.make({
      workspaceId: input.workspaceId,
      syncAccountId: input.syncAccountId,
      provider: GMAIL_PROVIDER,
      providerMessageId: ProviderObjectId.make(input.message.id),
      providerThreadId: ProviderObjectId.make(input.message.threadId),
      providerEvidence: gmailProviderEvidence(input.message),
      rawStorageKey,
      internetMessageId: parsed.internetMessageId,
      inReplyToMessageId: parsed.inReplyToMessageId,
      referenceMessageIds: parsed.referenceMessageIds,
      author: input.message.labelIds?.includes('SENT')
        ? { _tag: 'Member', memberId: input.memberId }
        : { _tag: 'External' },
      senderName: parsed.sender.displayName,
      senderAddress: parsed.sender.address,
      replyTo: parsed.replyTo.map((address, position) => ({
        position,
        displayName: address.displayName,
        address: address.address,
      })),
      recipients: parsed.recipients,
      subject: parsed.subject,
      textBody: parsed.textBody,
      htmlBody: parsed.htmlBody,
      attachments,
      authoredAt: parsed.authoredAt ?? internalTimestamp,
    })

    return yield* repository.ingestImported(envelope)
  },
)

export const gmailImportLayer = Layer.effect(
  GmailImport,
  Effect.gen(function* () {
    const repository = yield* MailRepository
    const objectStore = yield* MailObjectStore
    return GmailImport.of({
      importMessage: (input) =>
        importGmailRawMessage(input).pipe(
          Effect.provideService(MailRepository, repository),
          Effect.provideService(MailObjectStore, objectStore),
        ),
    })
  }),
)
