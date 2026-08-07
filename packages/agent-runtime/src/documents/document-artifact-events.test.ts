import { Deferred, Effect, Fiber, ManagedRuntime, Option, Stream } from 'effect'
import { afterAll, describe, expect, it } from 'vitest'
import {
  DocumentArtifactEvents,
  documentArtifactEventsLayer,
  documentArtifactOperationEvent,
} from './document-artifact-events'
import {
  DocumentArtifactEvent,
  type DocumentArtifactEvent as DocumentArtifactEventValue,
  type DocumentSnapshot,
} from './document-artifact-model'

const runtime = ManagedRuntime.make(documentArtifactEventsLayer)

afterAll(() => runtime.dispose())

const snapshot: DocumentSnapshot = {
  revision: 1,
  title: 'Plan',
  blocks: [{ id: 'body', html: '<p>Draft</p>', version: 1 }],
  lastModified: 1,
}

describe('DocumentArtifactEvents', () => {
  it('does not broadcast a pure conflict without a revision commit', () => {
    const event = documentArtifactOperationEvent({
      documentId: 'document-a',
      operation: {
        operationId: 'operation-conflict',
        senderId: 'client-a',
        baseRevision: 0,
        upserts: [{ id: 'body', html: '<p>Stale</p>', baseVersion: 0 }],
        deletes: [],
        order: ['body'],
      },
      outcome: {
        _tag: 'Conflict',
        snapshot,
        committed: false,
        accepted: [],
        deletedIds: [],
        conflicts: snapshot.blocks,
        missingIds: [],
      },
    })

    expect(Option.isNone(event)).toBe(true)
  })

  it('buffers an operation that races with the initial snapshot read', async () => {
    const events = await runtime.runPromise(
      Effect.gen(function* () {
        const service = yield* DocumentArtifactEvents
        const initialStarted = yield* Deferred.make<void>()
        const releaseInitial = yield* Deferred.make<void>()
        const initial = Deferred.succeed(initialStarted, undefined).pipe(
          Effect.andThen(Deferred.await(releaseInitial)),
          Effect.as(snapshot),
        )
        const received = yield* service
          .subscribe('document-1', initial)
          .pipe(Stream.take(2), Stream.runCollect, Effect.forkScoped)

        yield* Deferred.await(initialStarted)
        yield* service.publish(
          DocumentArtifactEvent.cases.Operation.make({
            documentId: 'document-1',
            operationId: 'operation-1',
            senderId: 'client-a',
            revision: 2,
            title: 'Plan',
            upserts: [{ id: 'body', html: '<p>Ready</p>', version: 2 }],
            deletedIds: [],
            order: ['body'],
            lastModified: 2,
          }),
        )
        yield* Deferred.succeed(releaseInitial, undefined)
        return yield* Fiber.join(received)
      }).pipe(Effect.scoped),
    )

    expect([...events].map((event) => event._tag)).toEqual([
      'Snapshot',
      'Operation',
    ])
  })

  it('isolates subscribers by canonical document id', async () => {
    const events = await runtime.runPromise(
      Effect.gen(function* () {
        const service = yield* DocumentArtifactEvents
        const received = yield* service
          .subscribe('document-a', Effect.succeed(snapshot))
          .pipe(Stream.take(2), Stream.runCollect, Effect.forkScoped)
        yield* Effect.yieldNow
        yield* service.publish(
          DocumentArtifactEvent.cases.Operation.make({
            documentId: 'document-b',
            operationId: 'operation-b',
            senderId: 'client-b',
            revision: 2,
            title: 'Other',
            upserts: [],
            deletedIds: [],
            order: [],
            lastModified: 2,
          }),
        )
        yield* service.publish(
          DocumentArtifactEvent.cases.Operation.make({
            documentId: 'document-a',
            operationId: 'operation-a',
            senderId: 'client-a',
            revision: 2,
            title: 'Plan',
            upserts: [],
            deletedIds: [],
            order: ['body'],
            lastModified: 2,
          }),
        )
        return yield* Fiber.join(received)
      }).pipe(Effect.scoped),
    )

    expect([...events].map((event) => event.documentId)).toEqual([
      'document-a',
      'document-a',
    ])
  })

  it('interrupts the scoped Effect subscription when the Web stream cancels', async () => {
    const first = await runtime.runPromise(
      Effect.gen(function* () {
        const service = yield* DocumentArtifactEvents
        const finalized = yield* Deferred.make<void>()
        const stream: Stream.Stream<DocumentArtifactEventValue, unknown> =
          service
            .subscribe('document-a', Effect.succeed(snapshot))
            .pipe(Stream.ensuring(Deferred.succeed(finalized, undefined)))
        const readable = yield* Stream.toReadableStreamEffect(stream)
        const reader = readable.getReader()
        const initial = yield* Effect.promise(() => reader.read())
        yield* Effect.promise(() => reader.cancel())
        yield* Deferred.await(finalized)
        return initial
      }),
    )

    expect(first.done).toBe(false)
    expect(first.value?._tag).toBe('Snapshot')
  })
})
