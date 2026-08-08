import { Effect, Layer, ManagedRuntime } from 'effect'
import { afterAll, describe, expect, it } from 'vitest'
import {
  DocumentArtifactEngine,
  documentArtifactEngineLayer,
} from './document-artifact-engine'
import {
  type DocumentArtifactDurableStorage,
  makeDocumentArtifactDurableRepositoryLayer,
} from './document-artifact-repository'

const values = new Map<string, unknown>()
const storage: DocumentArtifactDurableStorage = {
  get: async (key) => values.get(key),
  put: async (entries) => {
    for (const [key, value] of Object.entries(entries)) values.set(key, value)
  },
}
const runtime = ManagedRuntime.make(
  documentArtifactEngineLayer.pipe(
    Layer.provide(makeDocumentArtifactDurableRepositoryLayer(storage)),
  ),
)

afterAll(() => runtime.dispose())

describe('DocumentArtifact durable authority', () => {
  it('stores the source-shaped document and dedupe metadata atomically', async () => {
    const documentId = crypto.randomUUID()
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const engine = yield* DocumentArtifactEngine
        yield* engine.initialize(documentId, {
          title: 'Plan',
          blocks: [{ id: 'body', html: '<p>Draft</p>' }],
        })
        const command = {
          operationId: 'operation-1',
          senderId: 'client-a',
          baseRevision: 1,
          upserts: [{ id: 'body', html: '<p>Ready</p>', baseVersion: 1 }],
          deletes: [],
          order: ['body'],
        }
        const first = yield* engine.apply(documentId, command)
        const duplicate = yield* engine.apply(documentId, command)
        return { duplicate, first }
      }),
    )

    expect(result.first._tag).toBe('Applied')
    expect(result.duplicate._tag).toBe('Duplicate')
    expect(values.get(`document:v2:${documentId}`)).toEqual(
      result.first.snapshot,
    )
    expect(values.get(`document:operation-ids:v1:${documentId}`)).toEqual([
      'operation-1',
    ])
  })
})
