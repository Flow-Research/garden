import type { GardenDatabase } from '@garden/db'
import {
  mailAttachment,
  mailConversationMessage,
  mailMessage,
  mailMessageAttachment,
} from '@garden/db/schema'
import { and, eq } from 'drizzle-orm'
import { Effect } from 'effect'
import {
  AttachmentContentRef,
  MailRepositoryNotFoundError,
  RawMessageContentRef,
  type GetAttachmentContentRefInput,
  type GetRawMessageContentRefInput,
} from './contracts.ts'
import {
  databaseEffect,
  decodeRow,
  requireConversationAccess,
} from './shared.ts'

/** Returns a raw MIME key only when the actor can access its exact projection. */
export const getRawMessageContentRef = Effect.fn(
  'MailRepository.getRawMessageContentRef',
)(function* (db: GardenDatabase, input: GetRawMessageContentRefInput) {
  yield* requireConversationAccess(db, {
    workspaceId: input.workspaceId,
    actor: input.actor,
    conversationId: input.conversationId,
    write: false,
    operation: 'getRawMessageContentRef.authorize',
  })
  const rows = yield* databaseEffect('getRawMessageContentRef', () =>
    db
      .select({ rawStorageKey: mailMessage.rawStorageKey })
      .from(mailConversationMessage)
      .innerJoin(
        mailMessage,
        and(
          eq(mailMessage.id, mailConversationMessage.messageId),
          eq(mailMessage.workspaceId, mailConversationMessage.workspaceId),
        ),
      )
      .where(
        and(
          eq(mailConversationMessage.workspaceId, input.workspaceId),
          eq(mailConversationMessage.conversationId, input.conversationId),
          eq(mailConversationMessage.messageId, input.messageId),
        ),
      )
      .limit(1),
  )
  const key = rows[0]?.rawStorageKey
  if (key === null || key === undefined) {
    return yield* new MailRepositoryNotFoundError({
      entity: 'rawMessageContent',
      id: input.messageId,
      operation: 'getRawMessageContentRef',
      message: 'Projected message has no stored raw MIME content.',
    })
  }
  return yield* decodeRow(
    RawMessageContentRef,
    {
      messageId: input.messageId,
      storageKey: key,
      contentType: 'message/rfc822',
    },
    'getRawMessageContentRef.decode',
  )
})

/** Returns attachment storage metadata only through an authorized message projection. */
export const getAttachmentContentRef = Effect.fn(
  'MailRepository.getAttachmentContentRef',
)(function* (db: GardenDatabase, input: GetAttachmentContentRefInput) {
  yield* requireConversationAccess(db, {
    workspaceId: input.workspaceId,
    actor: input.actor,
    conversationId: input.conversationId,
    write: false,
    operation: 'getAttachmentContentRef.authorize',
  })
  const rows = yield* databaseEffect('getAttachmentContentRef', () =>
    db
      .select({ attachment: mailAttachment })
      .from(mailConversationMessage)
      .innerJoin(
        mailMessageAttachment,
        and(
          eq(
            mailMessageAttachment.messageId,
            mailConversationMessage.messageId,
          ),
          eq(
            mailMessageAttachment.workspaceId,
            mailConversationMessage.workspaceId,
          ),
        ),
      )
      .innerJoin(
        mailAttachment,
        and(
          eq(mailAttachment.id, mailMessageAttachment.attachmentId),
          eq(mailAttachment.workspaceId, mailMessageAttachment.workspaceId),
        ),
      )
      .where(
        and(
          eq(mailConversationMessage.workspaceId, input.workspaceId),
          eq(mailConversationMessage.conversationId, input.conversationId),
          eq(mailConversationMessage.messageId, input.messageId),
          eq(mailAttachment.id, input.attachmentId),
        ),
      )
      .limit(1),
  )
  const attachment = rows[0]?.attachment
  if (attachment === undefined) {
    return yield* new MailRepositoryNotFoundError({
      entity: 'attachmentContent',
      id: input.attachmentId,
      operation: 'getAttachmentContentRef',
      message: 'Attachment is not part of the authorized message projection.',
    })
  }
  return yield* decodeRow(
    AttachmentContentRef,
    {
      messageId: input.messageId,
      attachmentId: attachment.id,
      storageKey: attachment.storageKey,
      fileName: attachment.fileName,
      contentType: attachment.contentType,
      sizeBytes: attachment.sizeBytes,
      contentHash: attachment.contentHash,
    },
    'getAttachmentContentRef.decode',
  )
})
