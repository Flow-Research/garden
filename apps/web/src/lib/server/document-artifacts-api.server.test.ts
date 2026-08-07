import {
  DocumentArtifactRpcError,
  DocumentOperationOutcome,
  DocumentSnapshot,
} from '@garden/agent-runtime/src/documents/document-artifact-model'
import { Context, Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import { documentArtifactsApiWebHandler } from './document-artifacts-api.server'
import {
  documentArtifactApiErrorFromRpc,
  documentArtifactOperationFailure,
  DocumentArtifacts,
} from './document-artifacts-service'

vi.mock('./chat-agents', () => ({
  applyChatThreadDocumentArtifactOperation: vi.fn(),
  readChatThreadDocumentArtifact: vi.fn(),
  subscribeChatThreadDocumentArtifact: vi.fn(),
}))

const snapshot = DocumentSnapshot.make({
  revision: 1,
  title: 'Draft',
  blocks: [],
  lastModified: 1,
})
const DOCUMENT_ID = 'c482d5b3-9f1a-4f20-8c24-1c7d9c7507fd'

const testContext = Context.make(
  DocumentArtifacts,
  DocumentArtifacts.of({
    get: () => Effect.succeed(snapshot),
    apply: () =>
      Effect.succeed(
        DocumentOperationOutcome.cases.Unchanged.make({ snapshot }),
      ),
    subscribe: () =>
      Effect.succeed(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('event: artifact\n\n'))
            controller.close()
          },
        }),
      ),
  }),
)

describe('document artifacts Effect HttpApi', () => {
  it('serves a canonical snapshot through the web handler', async () => {
    const response = await documentArtifactsApiWebHandler(
      new Request(
        `https://garden.example/api/documents/${DOCUMENT_ID}/artifact`,
      ),
      testContext,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(snapshot)
  })

  it('decodes an operation and returns its typed outcome', async () => {
    const response = await documentArtifactsApiWebHandler(
      new Request(
        `https://garden.example/api/documents/${DOCUMENT_ID}/artifact`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            operationId: 'operation-1',
            senderId: 'editor-1',
            baseRevision: 1,
            upserts: [],
            deletes: [],
            order: [],
          }),
        },
      ),
      testContext,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(
      DocumentOperationOutcome.cases.Unchanged.make({ snapshot }),
    )
  })

  it('rejects malformed JSON at the shared Effect boundary', async () => {
    const response = await documentArtifactsApiWebHandler(
      new Request(
        `https://garden.example/api/documents/${DOCUMENT_ID}/artifact`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{',
        },
      ),
      testContext,
    )

    expect(response.status).toBe(400)
  })

  it('streams canonical collaboration events through the Effect HttpApi', async () => {
    const response = await documentArtifactsApiWebHandler(
      new Request(
        `https://garden.example/api/documents/${DOCUMENT_ID}/artifact/events`,
      ),
      testContext,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(
      'text/event-stream; charset=utf-8',
    )
    await expect(response.text()).resolves.toBe('event: artifact\n\n')
  })

  it('rejects a non-UUID document id before calling the service', async () => {
    const get = vi.fn(() => Effect.succeed(snapshot))
    const context = Context.make(
      DocumentArtifacts,
      DocumentArtifacts.of({
        get,
        apply: () =>
          Effect.succeed(
            DocumentOperationOutcome.cases.Unchanged.make({ snapshot }),
          ),
        subscribe: () => Effect.succeed(new ReadableStream<Uint8Array>()),
      }),
    )

    const response = await documentArtifactsApiWebHandler(
      new Request('https://garden.example/api/documents/not-a-uuid/artifact'),
      context,
    )

    expect(response.status).toBe(400)
    expect(get).not.toHaveBeenCalled()
  })

  it('never exposes infrastructure causes in operation errors', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = documentArtifactOperationFailure(
      'open document database',
      new Error('postgres://secret@internal.example failed'),
    )

    expect(error.message).toBe('Failed to open document database.')
    expect(JSON.stringify(error)).not.toContain('secret@internal.example')
    logged.mockRestore()
  })

  it('exhaustively maps typed RPC failures without leaking private details', () => {
    const validation = documentArtifactApiErrorFromRpc(
      DOCUMENT_ID,
      'apply document artifact',
      DocumentArtifactRpcError.cases.DocumentArtifactValidationError.make({
        message: 'Block version is invalid.',
      }),
    )
    const notFound = documentArtifactApiErrorFromRpc(
      DOCUMENT_ID,
      'read document artifact',
      DocumentArtifactRpcError.cases.DocumentArtifactNotFoundError.make({}),
    )
    const persistence = documentArtifactApiErrorFromRpc(
      DOCUMENT_ID,
      'read document artifact',
      DocumentArtifactRpcError.cases.DocumentArtifactPersistenceError.make({}),
    )
    const alreadyExists = documentArtifactApiErrorFromRpc(
      DOCUMENT_ID,
      'apply document artifact',
      DocumentArtifactRpcError.cases.DocumentArtifactAlreadyExistsError.make(
        {},
      ),
    )
    const importFailure = documentArtifactApiErrorFromRpc(
      DOCUMENT_ID,
      'apply document artifact',
      DocumentArtifactRpcError.cases.DocumentArtifactImportError.make({}),
    )

    expect(validation).toMatchObject({
      _tag: 'DocumentArtifactValidationError',
      message: 'Block version is invalid.',
    })
    expect(notFound).toMatchObject({
      _tag: 'DocumentArtifactNotFoundError',
      documentId: DOCUMENT_ID,
    })
    expect(persistence).toMatchObject({
      _tag: 'DocumentArtifactOperationError',
      message: 'Failed to read document artifact.',
    })
    expect(alreadyExists).toMatchObject({
      _tag: 'DocumentArtifactOperationError',
      message: 'Failed to apply document artifact.',
    })
    expect(importFailure).toMatchObject({
      _tag: 'DocumentArtifactOperationError',
      message: 'Failed to apply document artifact.',
    })
  })
})
