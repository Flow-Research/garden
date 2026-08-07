import { Effect, Layer, ManagedRuntime } from 'effect'
import { afterAll, describe, expect, it } from 'vitest'
import {
  DocumentArtifactEngine,
  documentArtifactEngineLayer,
} from './document-artifact-engine'
import { documentArtifactMemoryRepositoryLayer } from './document-artifact-repository'

const testLayer = documentArtifactEngineLayer.pipe(
  Layer.provide(documentArtifactMemoryRepositoryLayer),
)
const runtime = ManagedRuntime.make(testLayer)

const run = <A, E>(effect: Effect.Effect<A, E, DocumentArtifactEngine>) =>
  runtime.runPromise(effect)

const initialize = () => {
  const documentId = crypto.randomUUID()
  return run(
    Effect.gen(function* () {
      const engine = yield* DocumentArtifactEngine
      const snapshot = yield* engine.initialize(documentId, {
        title: 'Plan',
        blocks: [
          { id: 'intro', html: '<p>Introduction</p>' },
          { id: 'body', html: '<p>Draft</p>' },
        ],
      })
      return { documentId, snapshot }
    }),
  )
}

afterAll(() => runtime.dispose())

describe('DocumentArtifactEngine', () => {
  it('applies compact block changes through the public Effect service', async () => {
    const { documentId } = await initialize()
    const outcome = await run(
      Effect.gen(function* () {
        const engine = yield* DocumentArtifactEngine
        return yield* engine.apply(documentId, {
          operationId: 'operation-1',
          senderId: 'client-a',
          baseRevision: 1,
          upserts: [{ id: 'body', html: '<p>Ready</p>', baseVersion: 1 }],
          deletes: [],
          order: ['intro', 'body'],
        })
      }),
    )

    expect(outcome._tag).toBe('Applied')
    expect(outcome.snapshot.revision).toBe(2)
    expect(outcome.snapshot.blocks[1]).toMatchObject({
      id: 'body',
      html: '<p>Ready</p>',
      version: 2,
    })
  })

  it('commits non-conflicting blocks and returns authoritative conflicts', async () => {
    const { documentId } = await initialize()
    const outcome = await run(
      Effect.gen(function* () {
        const engine = yield* DocumentArtifactEngine
        return yield* engine.apply(documentId, {
          operationId: 'operation-2',
          senderId: 'client-b',
          baseRevision: 0,
          upserts: [
            { id: 'intro', html: '<p>Stale</p>', baseVersion: 0 },
            { id: 'body', html: '<p>Accepted</p>', baseVersion: 1 },
          ],
          deletes: [],
          order: ['intro', 'body'],
        })
      }),
    )

    expect(outcome._tag).toBe('Conflict')
    if (outcome._tag !== 'Conflict') return
    expect(outcome.conflicts).toEqual([
      { id: 'intro', html: '<p>Introduction</p>', version: 1 },
    ])
    expect(outcome.snapshot.blocks[1]?.html).toBe('<p>Accepted</p>')
  })

  it('deduplicates operation ids inside the repository transaction', async () => {
    const { documentId } = await initialize()
    const program = Effect.gen(function* () {
      const engine = yield* DocumentArtifactEngine
      const command = {
        operationId: 'operation-3',
        senderId: 'client-a',
        baseRevision: 1,
        upserts: [{ id: 'body', html: '<p>Once</p>', baseVersion: 1 }],
        deletes: [],
        order: ['intro', 'body'],
      }
      const first = yield* engine.apply(documentId, command)
      const second = yield* engine.apply(documentId, command)
      return { first, second }
    })

    const result = await run(program)
    expect(result.first._tag).toBe('Applied')
    expect(result.second._tag).toBe('Duplicate')
    expect(result.second.snapshot.revision).toBe(2)
  })

  it('serializes concurrent writes so one stale block version conflicts', async () => {
    const { documentId } = await initialize()
    const outcomes = await run(
      Effect.gen(function* () {
        const engine = yield* DocumentArtifactEngine
        return yield* Effect.all(
          ['a', 'b'].map((suffix) =>
            engine.apply(documentId, {
              operationId: `operation-${suffix}`,
              senderId: `client-${suffix}`,
              baseRevision: 1,
              upserts: [
                {
                  id: 'body',
                  html: `<p>${suffix}</p>`,
                  baseVersion: 1,
                },
              ],
              deletes: [],
              order: ['intro', 'body'],
            }),
          ),
          { concurrency: 'unbounded' },
        )
      }),
    )

    expect(outcomes.map((outcome) => outcome._tag).sort()).toEqual([
      'Applied',
      'Conflict',
    ])
  })

  it('rejects an upsert/delete overlap through the typed failure channel', async () => {
    const { documentId } = await initialize()
    const exit = await runtime.runPromiseExit(
      Effect.gen(function* () {
        const engine = yield* DocumentArtifactEngine
        return yield* engine.apply(documentId, {
          operationId: 'operation-invalid',
          senderId: 'client-a',
          baseRevision: 1,
          upserts: [{ id: 'body', html: '<p>x</p>', baseVersion: 1 }],
          deletes: [{ id: 'body', baseVersion: 1 }],
          order: [],
        })
      }),
    )

    expect(exit._tag).toBe('Failure')
    expect(String(exit)).toContain('DocumentArtifactValidationError')
  })

  it('sanitizes operation HTML before it reaches canonical storage', async () => {
    const { documentId } = await initialize()
    const outcome = await run(
      Effect.gen(function* () {
        const engine = yield* DocumentArtifactEngine
        return yield* engine.apply(documentId, {
          operationId: 'operation-sanitize',
          senderId: 'client-a',
          baseRevision: 1,
          upserts: [
            {
              id: 'body',
              html: '<p onclick="steal()">Safe<script>steal()</script></p>',
              baseVersion: 1,
            },
          ],
          deletes: [],
          order: ['intro', 'body'],
        })
      }),
    )

    expect(outcome.snapshot.blocks[1]?.html).toBe('<p>Safe</p>')
  })
})
