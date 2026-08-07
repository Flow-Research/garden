import {
  DocumentOperationOutcome,
  DocumentSnapshot,
} from '@garden/agent-runtime/src/documents/document-artifact-model'
import { Context, Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import { documentArtifactsApiWebHandler } from './document-artifacts-api.server'
import { DocumentArtifacts } from './document-artifacts-service'

vi.mock('./chat-agents', () => ({
  applyChatThreadDocumentArtifactOperation: vi.fn(),
  readChatThreadDocumentArtifact: vi.fn(),
}))

const snapshot = DocumentSnapshot.make({
  revision: 1,
  title: 'Draft',
  blocks: [],
  lastModified: 1,
})

const testContext = Context.make(
  DocumentArtifacts,
  DocumentArtifacts.of({
    get: () => Effect.succeed(snapshot),
    apply: () =>
      Effect.succeed(
        DocumentOperationOutcome.cases.Unchanged.make({ snapshot }),
      ),
  }),
)

describe('document artifacts Effect HttpApi', () => {
  it('serves a canonical snapshot through the web handler', async () => {
    const response = await documentArtifactsApiWebHandler(
      new Request('https://garden.example/api/documents/document-1/artifact'),
      testContext,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(snapshot)
  })

  it('decodes an operation and returns its typed outcome', async () => {
    const response = await documentArtifactsApiWebHandler(
      new Request('https://garden.example/api/documents/document-1/artifact', {
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
      }),
      testContext,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(
      DocumentOperationOutcome.cases.Unchanged.make({ snapshot }),
    )
  })

  it('rejects malformed JSON at the shared Effect boundary', async () => {
    const response = await documentArtifactsApiWebHandler(
      new Request('https://garden.example/api/documents/document-1/artifact', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{',
      }),
      testContext,
    )

    expect(response.status).toBe(400)
  })
})
