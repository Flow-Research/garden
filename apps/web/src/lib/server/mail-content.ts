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
 * Maps typed Effect failures at the HTTP boundary without leaking persistence
 * or object-store details. Unknown defects stay with the global route handler
 * so Garden keeps its request-id-backed 500 response and logging.
 */
export function mailContentErrorResponse(error: unknown): Response | null {
  const tag =
    typeof error === 'object' &&
    error !== null &&
    '_tag' in error &&
    typeof error._tag === 'string'
      ? error._tag
      : null
  switch (tag) {
    case 'MailRequestUnauthorizedError':
      return Response.json(
        { error: 'Authentication required.' },
        { status: 401 },
      )
    case 'MailRequestForbiddenError':
    case 'MailRepositoryAccessDeniedError':
      return Response.json({ error: 'Mail access denied.' }, { status: 403 })
    case 'MailRepositoryNotFoundError':
    case 'MailObjectNotFoundError':
      return Response.json(
        { error: 'Mail content not found.' },
        { status: 404 },
      )
    case 'ParseError':
      return Response.json(
        { error: 'Mail content identifiers are invalid.' },
        { status: 400 },
      )
    default:
      return null
  }
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
