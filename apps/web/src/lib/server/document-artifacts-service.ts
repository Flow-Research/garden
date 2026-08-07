import {
  DocumentArtifactNotFoundError,
  DocumentArtifactRpcError,
  DocumentArtifactValidationError,
  type DocumentOperation,
  type DocumentOperationOutcome,
  type DocumentSnapshot,
} from '@garden/agent-runtime/src/documents/document-artifact-model'
import { and, eq } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import { createGardenLogger, errorFields } from '@garden/observability/logger'
import {
  DocumentArtifactForbiddenError,
  DocumentArtifactOperationError,
  DocumentArtifactUnauthorizedError,
} from '@/lib/api/document-artifact-contract'
import {
  applyChatThreadDocumentArtifactOperation,
  readChatThreadDocumentArtifact,
  subscribeChatThreadDocumentArtifact,
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
  readonly subscribe: (
    documentId: string,
  ) => Effect.Effect<ReadableStream<Uint8Array>, DocumentArtifactApiError>
}

export class DocumentArtifacts extends Context.Service<
  DocumentArtifacts,
  DocumentArtifactsService
>()('@garden/web/DocumentArtifacts') {}

const documentArtifactsLogger = createGardenLogger({
  service: 'garden-staging',
  component: 'document-artifacts-api',
})

/** Logs the private cause while exposing only a stable operation failure. */
export const documentArtifactOperationFailure = (
  operation: string,
  cause: unknown,
) => {
  documentArtifactsLogger.error('document_artifacts.operation_failed', {
    operation,
    ...errorFields(cause),
  })
  return new DocumentArtifactOperationError({
    operation,
    message: `Failed to ${operation}.`,
  })
}

/** Exhaustively maps the typed RPC envelope into declared HttpApi errors. */
export const documentArtifactApiErrorFromRpc = (
  documentId: string,
  operation: string,
  error: DocumentArtifactRpcError,
):
  | DocumentArtifactNotFoundError
  | DocumentArtifactValidationError
  | DocumentArtifactOperationError =>
  DocumentArtifactRpcError.match<
    | DocumentArtifactNotFoundError
    | DocumentArtifactValidationError
    | DocumentArtifactOperationError
  >(error, {
    DocumentArtifactNotFoundError: () =>
      new DocumentArtifactNotFoundError({ documentId }),
    DocumentArtifactValidationError: ({ message }) =>
      new DocumentArtifactValidationError({ operation, message }),
    DocumentArtifactPersistenceError: () =>
      new DocumentArtifactOperationError({
        operation,
        message: `Failed to ${operation}.`,
      }),
    DocumentArtifactAlreadyExistsError: () =>
      new DocumentArtifactOperationError({
        operation,
        message: `Failed to ${operation}.`,
      }),
    DocumentArtifactImportError: () =>
      new DocumentArtifactOperationError({
        operation,
        message: `Failed to ${operation}.`,
      }),
  })

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
        catch: (cause) =>
          documentArtifactOperationFailure('load document session', cause),
      })
      if (!session?.user) {
        return yield* new DocumentArtifactUnauthorizedError({
          message: 'Unauthorized',
        })
      }

      const db = yield* Effect.tryPromise({
        try: () => request.db(),
        catch: (cause) =>
          documentArtifactOperationFailure('open document database', cause),
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
              and(
                eq(schema.document.threadId, schema.chatThread.id),
                eq(schema.document.workspaceId, schema.chatThread.workspaceId),
              ),
            )
            .innerJoin(
              schema.agent,
              and(
                eq(schema.chatThread.agentId, schema.agent.id),
                eq(schema.chatThread.workspaceId, schema.agent.workspaceId),
              ),
            )
            .where(eq(schema.document.id, documentId))
            .limit(1),
        catch: (cause) =>
          documentArtifactOperationFailure('load document access', cause),
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
        catch: (cause) =>
          documentArtifactOperationFailure('load document membership', cause),
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
        catch: (cause) =>
          documentArtifactOperationFailure('read document artifact', cause),
      })
      if (!result.ok) {
        return yield* documentArtifactApiErrorFromRpc(
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
        catch: (cause) =>
          documentArtifactOperationFailure('apply document artifact', cause),
      })
      if (!result.ok) {
        return yield* documentArtifactApiErrorFromRpc(
          documentId,
          'apply document artifact',
          result.error,
        )
      }
      return result.outcome
    })

    /** Bridges the authorized facet stream without moving authority into HTTP. */
    const subscribe = Effect.fn('DocumentArtifacts.subscribe')(function* (
      documentId: string,
    ) {
      const row = yield* authorize(documentId)
      return yield* Effect.tryPromise({
        try: () =>
          subscribeChatThreadDocumentArtifact({
            documentId,
            hostName: row.hostName,
            threadId: row.threadId,
          }),
        catch: (cause) =>
          documentArtifactOperationFailure(
            'subscribe to document artifact',
            cause,
          ),
      })
    })

    return DocumentArtifacts.of({ get, apply, subscribe })
  }),
)
