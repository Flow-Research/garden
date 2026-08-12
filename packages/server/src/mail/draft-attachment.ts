import type { GardenDatabase } from '@garden/db'
import {
  mailAttachment,
  mailDraftAttachment,
  mailMessageAttachment,
} from '@garden/db/schema'
import {
  AttachmentId,
  MailboxId,
  NonEmptyString,
  NonNegativeInt,
  Sha256,
  StorageKey,
  WorkspaceId,
} from '@garden/core/mail'
import { and, eq, isNotNull, like, or } from 'drizzle-orm'
import { Effect, Schema } from 'effect'
import { sha256 } from './content-addressing.ts'
import { MailObjectStore } from './object-store.ts'

export const MAX_OUTBOUND_ATTACHMENT_BYTES = 25 * 1024 * 1024

export const DraftAttachmentUploadInput = Schema.Struct({
  workspaceId: WorkspaceId,
  mailboxId: MailboxId,
  fileName: NonEmptyString,
  contentType: NonEmptyString,
  content: Schema.Uint8Array,
})
export interface DraftAttachmentUploadInput extends Schema.Schema.Type<
  typeof DraftAttachmentUploadInput
> {}

/** Public attachment metadata; storage identity never crosses the client boundary. */
export const DraftAttachmentDescriptor = Schema.Struct({
  attachmentId: AttachmentId,
  fileName: NonEmptyString,
  contentType: NonEmptyString,
  sizeBytes: NonNegativeInt,
})
export interface DraftAttachmentDescriptor extends Schema.Schema.Type<
  typeof DraftAttachmentDescriptor
> {}

export class DraftAttachmentValidationError extends Schema.TaggedErrorClass<DraftAttachmentValidationError>()(
  'DraftAttachmentValidationError',
  { message: Schema.String },
) {}

export class DraftAttachmentPersistenceError extends Schema.TaggedErrorClass<DraftAttachmentPersistenceError>()(
  'DraftAttachmentPersistenceError',
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

/** Enforces the same writable/sendable mailbox policy as draft creation. */
export const authorizeDraftAttachmentUpload = Effect.fn(
  'DraftAttachment.authorize',
)(function* (
  mailboxes: ReadonlyArray<{
    readonly id: typeof MailboxId.Type
    readonly accessLevel: string
    readonly sendCapability: string
  }>,
  mailboxId: typeof MailboxId.Type,
) {
  const mailbox = mailboxes.find((candidate) => candidate.id === mailboxId)
  if (
    mailbox === undefined ||
    mailbox.accessLevel === 'viewer' ||
    mailbox.sendCapability === 'read_only'
  ) {
    return yield* new DraftAttachmentValidationError({
      message: 'Mailbox attachment access denied.',
    })
  }
  return mailbox
})

/** Removes path/control characters using Agentic Inbox's attachment convention. */
const safeFileName = (value: string): string =>
  Array.from(value.trim(), (character) =>
    character.charCodeAt(0) <= 31 || /[\\/:*?"<>|]/.test(character)
      ? '_'
      : character,
  )
    .join('')
    .slice(0, 255)

/** Restricts persisted MIME metadata to a conventional media type token pair. */
const safeContentType = (value: string): string => {
  const normalized = value.trim().toLowerCase()
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(normalized)
    ? normalized
    : 'application/octet-stream'
}

/** Draft uploads use an opaque id plus content hash inside the existing mail prefix. */
const draftAttachmentStorageKey = (input: {
  workspaceId: typeof WorkspaceId.Type
  mailboxId: typeof MailboxId.Type
  attachmentId: typeof AttachmentId.Type
  contentHash: typeof Sha256.Type
}): typeof StorageKey.Type =>
  StorageKey.make(
    `mail/${input.workspaceId}/mailboxes/${input.mailboxId}/attachments/drafts/${input.attachmentId}-${input.contentHash}`,
  )

/**
 * Persists immutable attachment bytes and metadata as one Effect workflow.
 * Caller must authorize mailbox write access before invoking this function.
 * If metadata persistence fails, the just-written object is removed.
 */
export const storeDraftAttachment = Effect.fn('DraftAttachment.store')(
  function* (db: GardenDatabase, input: DraftAttachmentUploadInput) {
    if (
      input.content.byteLength === 0 ||
      input.content.byteLength > MAX_OUTBOUND_ATTACHMENT_BYTES
    ) {
      return yield* new DraftAttachmentValidationError({
        message: 'Attachments must be between 1 byte and 25 MB.',
      })
    }
    const fileName = safeFileName(input.fileName)
    if (fileName.length === 0) {
      return yield* new DraftAttachmentValidationError({
        message: 'Attachment filename is required.',
      })
    }

    const store = yield* MailObjectStore
    const attachmentId = AttachmentId.make(crypto.randomUUID())
    const contentHash = yield* sha256(input.content)
    const storageKey = draftAttachmentStorageKey({
      workspaceId: input.workspaceId,
      mailboxId: input.mailboxId,
      attachmentId,
      contentHash,
    })
    const contentType = safeContentType(input.contentType)
    yield* store.put({
      key: storageKey,
      content: input.content,
      contentType,
    })

    const inserted = yield* Effect.tryPromise({
      try: () =>
        db
          .insert(mailAttachment)
          .values({
            id: attachmentId,
            workspaceId: input.workspaceId,
            storageKey,
            fileName,
            contentType,
            sizeBytes: input.content.byteLength,
            contentHash,
          })
          .returning({ id: mailAttachment.id }),
      catch: (cause) =>
        new DraftAttachmentPersistenceError({
          operation: 'insertMetadata',
          message: 'Attachment metadata could not be persisted.',
          cause,
        }),
    }).pipe(Effect.tapError(() => store.delete(storageKey).pipe(Effect.ignore)))
    if (inserted[0] === undefined) {
      yield* store.delete(storageKey).pipe(Effect.ignore)
      return yield* new DraftAttachmentPersistenceError({
        operation: 'insertMetadata',
        message: 'Attachment metadata insert returned no row.',
      })
    }

    return DraftAttachmentDescriptor.make({
      attachmentId,
      fileName,
      contentType,
      sizeBytes: input.content.byteLength,
    })
  },
)

/** Removes only an unreferenced upload inside the caller-authorized workspace. */
export const deleteUnreferencedDraftAttachment = Effect.fn(
  'DraftAttachment.deleteUnreferenced',
)(function* (
  db: GardenDatabase,
  input: {
    workspaceId: typeof WorkspaceId.Type
    mailboxId: typeof MailboxId.Type
    attachmentId: typeof AttachmentId.Type
  },
) {
  const rows = yield* Effect.tryPromise({
    try: () =>
      db
        .select({ storageKey: mailAttachment.storageKey })
        .from(mailAttachment)
        .leftJoin(
          mailDraftAttachment,
          eq(mailDraftAttachment.attachmentId, mailAttachment.id),
        )
        .leftJoin(
          mailMessageAttachment,
          eq(mailMessageAttachment.attachmentId, mailAttachment.id),
        )
        .where(
          and(
            eq(mailAttachment.workspaceId, input.workspaceId),
            eq(mailAttachment.id, input.attachmentId),
            like(
              mailAttachment.storageKey,
              `mail/${input.workspaceId}/mailboxes/${input.mailboxId}/attachments/drafts/%`,
            ),
            or(
              isNotNull(mailDraftAttachment.attachmentId),
              isNotNull(mailMessageAttachment.attachmentId),
            ),
          ),
        )
        .limit(1),
    catch: (cause) =>
      new DraftAttachmentPersistenceError({
        operation: 'findForDelete',
        message: 'Attachment could not be inspected for deletion.',
        cause,
      }),
  })
  // A referenced or missing attachment is deliberately a no-op: callers can
  // remove it from a draft but cannot destroy immutable sent-message content.
  if (rows[0] !== undefined) return false

  const candidates = yield* Effect.tryPromise({
    try: () =>
      db
        .select({ storageKey: mailAttachment.storageKey })
        .from(mailAttachment)
        .where(
          and(
            eq(mailAttachment.workspaceId, input.workspaceId),
            eq(mailAttachment.id, input.attachmentId),
            like(
              mailAttachment.storageKey,
              `mail/${input.workspaceId}/mailboxes/${input.mailboxId}/attachments/drafts/%`,
            ),
          ),
        )
        .limit(1),
    catch: (cause) =>
      new DraftAttachmentPersistenceError({
        operation: 'loadForDelete',
        message: 'Attachment could not be loaded for deletion.',
        cause,
      }),
  })
  const candidate = candidates[0]
  if (candidate === undefined) return false

  const deleted = yield* Effect.tryPromise({
    try: () =>
      db
        .delete(mailAttachment)
        .where(
          and(
            eq(mailAttachment.workspaceId, input.workspaceId),
            eq(mailAttachment.id, input.attachmentId),
            like(
              mailAttachment.storageKey,
              `mail/${input.workspaceId}/mailboxes/${input.mailboxId}/attachments/drafts/%`,
            ),
          ),
        )
        .returning({ storageKey: mailAttachment.storageKey }),
    catch: (cause) =>
      new DraftAttachmentPersistenceError({
        operation: 'deleteMetadata',
        message: 'Attachment metadata could not be deleted.',
        cause,
      }),
  })
  if (deleted[0] === undefined) return false
  const store = yield* MailObjectStore
  yield* store.delete(StorageKey.make(candidate.storageKey))
  return true
})
