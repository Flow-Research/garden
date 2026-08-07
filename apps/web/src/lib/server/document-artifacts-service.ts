import {
  DocumentArtifactNotFoundError,
  DocumentArtifactValidationError,
  type DocumentOperation,
  type DocumentOperationOutcome,
  type DocumentSnapshot,
} from '@garden/agent-runtime/src/documents/document-artifact-model'
import { and, eq } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import {
  DocumentArtifactForbiddenError,
  DocumentArtifactOperationError,
  DocumentArtifactUnauthorizedError,
} from '@/lib/api/document-artifact-contract'
import {
  applyChatThreadDocumentArtifactOperation,
  readChatThreadDocumentArtifact,
} from './chat-agents'
import { schema } from './db'
import { AppRequest } from './effect-context'

type DocumentArtifactApiError =
  | DocumentArtifactUnauthorizedError
  | DocumentArtifactForbiddenError
  | DocumentArtifactNotFoundError
  | DocumentArtifactValidationError
  | DocumentArtifactOperationError

export interface DocumentArtifactsService {
  readonly get: (
    documentId: string,
  ) => Effect.Effect<DocumentSnapshot, DocumentArtifactApiError>
  readonly apply: (
    documentId: string,
    operation: DocumentOperation,
  ) => Effect.Effect<DocumentOperationOutcome, DocumentArtifactApiError>
}

export class DocumentArtifacts extends Context.Service<
  DocumentArtifacts,
  DocumentArtifactsService
>()('@garden/web/DocumentArtifacts') {}

const operationFailure = (operation: string, cause: unknown) =>
  new DocumentArtifactOperationError({
    operation,
    message: cause instanceof Error ? cause.message : String(cause),
  })

/** Preserves the domain error class encoded in the chat-facet RPC message. */
const rpcFailure = (documentId: string, operation: string, message: string) => {
  if (message.startsWith('DocumentArtifactNotFoundError:')) {
    return new DocumentArtifactNotFoundError({ documentId })
  }
  if (message.startsWith('DocumentArtifactValidationError:')) {
    return new DocumentArtifactValidationError({ operation, message })
  }
  return new DocumentArtifactOperationError({ operation, message })
}

/**
 * Adapts request-owned authorization and the existing AgentDO RPC functions to
 * one Effect service. The Durable Object remains canonical storage authority.
 */
export const documentArtifactsLayer = Layer.effect(
  DocumentArtifacts,
  Effect.gen(function* () {
    const request = yield* AppRequest

    /** Mirrors legacy document access while keeping transport types out of the service. */
    const authorize = Effect.fn('DocumentArtifacts.authorize')(function* (
      documentId: string,
    ) {
      const session = yield* Effect.tryPromise({
        try: () => request.auth.getSession(),
        catch: (cause) => operationFailure('load document session', cause),
      })
      if (!session?.user) {
        return yield* new DocumentArtifactUnauthorizedError({
          message: 'Unauthorized',
        })
      }

      const db = yield* Effect.tryPromise({
        try: () => request.db(),
        catch: (cause) => operationFailure('open document database', cause),
      })
      const rows = yield* Effect.tryPromise({
        try: () =>
          db
            .select({
              hostName: schema.agent.hostName,
              ownerUserId: schema.document.ownerUserId,
              threadId: schema.document.threadId,
              workspaceId: schema.document.workspaceId,
            })
            .from(schema.document)
            .innerJoin(
              schema.chatThread,
              eq(schema.document.threadId, schema.chatThread.id),
            )
            .innerJoin(
              schema.agent,
              eq(schema.chatThread.agentId, schema.agent.id),
            )
            .where(eq(schema.document.id, documentId))
            .limit(1),
        catch: (cause) => operationFailure('load document access', cause),
      })
      const row = rows[0]
      if (!row) {
        return yield* new DocumentArtifactNotFoundError({ documentId })
      }

      const memberships = yield* Effect.tryPromise({
        try: () =>
          db
            .select({ id: schema.member.id })
            .from(schema.member)
            .where(
              and(
                eq(schema.member.organizationId, row.workspaceId),
                eq(schema.member.userId, session.user.id),
              ),
            )
            .limit(1),
        catch: (cause) => operationFailure('load document membership', cause),
      })
      if (!memberships[0] && row.ownerUserId !== session.user.id) {
        return yield* new DocumentArtifactForbiddenError({
          message: 'Document access denied',
        })
      }
      if (!row.threadId || !row.hostName) {
        return yield* new DocumentArtifactNotFoundError({ documentId })
      }
      return { hostName: row.hostName, threadId: row.threadId }
    })

    const get = Effect.fn('DocumentArtifacts.get')(function* (
      documentId: string,
    ) {
      const row = yield* authorize(documentId)
      const result = yield* Effect.tryPromise({
        try: () =>
          readChatThreadDocumentArtifact({
            documentId,
            hostName: row.hostName,
            threadId: row.threadId,
          }),
        catch: (cause) => operationFailure('read document artifact', cause),
      })
      if (!result.ok) {
        return yield* rpcFailure(
          documentId,
          'read document artifact',
          result.error,
        )
      }
      return result.snapshot
    })

    const apply = Effect.fn('DocumentArtifacts.apply')(function* (
      documentId: string,
      operation: DocumentOperation,
    ) {
      const row = yield* authorize(documentId)
      const result = yield* Effect.tryPromise({
        try: () =>
          applyChatThreadDocumentArtifactOperation({
            documentId,
            hostName: row.hostName,
            operation,
            threadId: row.threadId,
          }),
        catch: (cause) => operationFailure('apply document artifact', cause),
      })
      if (!result.ok) {
        return yield* rpcFailure(
          documentId,
          'apply document artifact',
          result.error,
        )
      }
      return result.outcome
    })

    return DocumentArtifacts.of({ get, apply })
  }),
)
