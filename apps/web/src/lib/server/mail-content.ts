import {
  AttachmentId,
  ConversationId,
  MessageId,
  WorkspaceId,
} from '@garden/core/mail'
import {
  MailObjectStore,
  MailRepository,
  makeMailRepositoryLayer,
  makeR2MailObjectStoreLayer,
} from '@garden/server/mail'
import { Effect, Layer, Schema } from 'effect'
import type { AppRequestContext } from './context'
import { requireMailMemberAuthority } from './mail-authority'

type MailContentIdentity = {
  workspaceId: string
  conversationId: string
  messageId: string
}

/**
 * Reads raw MIME only after the repository proves the member can see the exact
 * conversation/message projection. Storage keys remain inside this server
 * boundary and are never serialized to the browser.
 */
export async function readAuthorizedRawMessage(
  context: AppRequestContext,
  input: MailContentIdentity,
) {
  return await Effect.runPromise(
    Effect.gen(function* () {
      const workspaceId = yield* Schema.decodeUnknownEffect(WorkspaceId)(
        input.workspaceId,
      )
      const conversationId = yield* Schema.decodeUnknownEffect(ConversationId)(
        input.conversationId,
      )
      const messageId = yield* Schema.decodeUnknownEffect(MessageId)(
        input.messageId,
      )
      const authority = yield* requireMailMemberAuthority(context, workspaceId)
      const dependencies = Layer.merge(
        makeMailRepositoryLayer(authority.db),
        makeR2MailObjectStoreLayer(context.env.FILES),
      )
      return yield* Effect.gen(function* () {
        const repository = yield* MailRepository
        const store = yield* MailObjectStore
        const reference = yield* repository.getRawMessageContentRef({
          workspaceId,
          actor: authority.actor,
          conversationId,
          messageId,
        })
        const object = yield* store.get(reference.storageKey)
        return { content: object.content, contentType: reference.contentType }
      }).pipe(Effect.provide(dependencies))
    }),
  )
}

/**
 * Reads an attachment only after exact conversation/message/attachment
 * authorization. Immutable repository metadata controls response name and
 * content type rather than untrusted request query parameters.
 */
export async function readAuthorizedMailAttachment(
  context: AppRequestContext,
  input: MailContentIdentity & { attachmentId: string },
) {
  return await Effect.runPromise(
    Effect.gen(function* () {
      const workspaceId = yield* Schema.decodeUnknownEffect(WorkspaceId)(
        input.workspaceId,
      )
      const conversationId = yield* Schema.decodeUnknownEffect(ConversationId)(
        input.conversationId,
      )
      const messageId = yield* Schema.decodeUnknownEffect(MessageId)(
        input.messageId,
      )
      const attachmentId = yield* Schema.decodeUnknownEffect(AttachmentId)(
        input.attachmentId,
      )
      const authority = yield* requireMailMemberAuthority(context, workspaceId)
      const dependencies = Layer.merge(
        makeMailRepositoryLayer(authority.db),
        makeR2MailObjectStoreLayer(context.env.FILES),
      )
      return yield* Effect.gen(function* () {
        const repository = yield* MailRepository
        const store = yield* MailObjectStore
        const reference = yield* repository.getAttachmentContentRef({
          workspaceId,
          actor: authority.actor,
          conversationId,
          messageId,
          attachmentId,
        })
        const object = yield* store.get(reference.storageKey)
        return {
          content: object.content,
          contentType: reference.contentType,
          fileName: reference.fileName,
        }
      }).pipe(Effect.provide(dependencies))
    }),
  )
}
