import { Context, Effect, Layer, Schema, SynchronizedRef } from 'effect'
import {
  DocumentArtifactAlreadyExistsError,
  type DocumentArtifactError,
  DocumentArtifactNotFoundError,
  DocumentArtifactPersistenceError,
  DocumentOperationOutcome,
  type DocumentOperationOutcome as DocumentOperationOutcomeValue,
  type DocumentSnapshot,
  StoredDocumentArtifact,
  type StoredDocumentArtifact as StoredDocumentArtifactValue,
} from './document-artifact-model'

const MAX_RECORDED_OPERATION_IDS = 1_000

export type DocumentTransition = (
  snapshot: DocumentSnapshot,
) => Effect.Effect<DocumentOperationOutcomeValue, DocumentArtifactError>

export interface DocumentArtifactRepositoryService {
  readonly get: (
    documentId: string,
  ) => Effect.Effect<DocumentSnapshot, DocumentArtifactError>
  readonly initialize: (
    documentId: string,
    snapshot: DocumentSnapshot,
  ) => Effect.Effect<DocumentSnapshot, DocumentArtifactError>
  readonly transact: (
    documentId: string,
    operationId: string,
    transition: DocumentTransition,
  ) => Effect.Effect<DocumentOperationOutcomeValue, DocumentArtifactError>
}

/** Atomic persistence port for canonical document artifact snapshots. */
export class DocumentArtifactRepository extends Context.Service<
  DocumentArtifactRepository,
  DocumentArtifactRepositoryService
>()('@garden/documents/DocumentArtifactRepository') {}

const rememberOperation = (
  current: StoredDocumentArtifactValue,
  operationId: string,
  snapshot: DocumentSnapshot,
): StoredDocumentArtifactValue => ({
  snapshot,
  appliedOperationIds: [
    ...current.appliedOperationIds.filter((id) => id !== operationId),
    operationId,
  ].slice(-MAX_RECORDED_OPERATION_IDS),
})

const duplicateOutcome = (
  snapshot: DocumentSnapshot,
  operationId: string,
): DocumentOperationOutcomeValue =>
  DocumentOperationOutcome.cases.Duplicate.make({ snapshot, operationId })

/**
 * In-memory repository used by public-service tests and local prototypes.
 * `SynchronizedRef.modifyEffect` preserves the same serialized transition
 * contract as the Durable Object adapter, including effectful validation.
 */
export const documentArtifactMemoryRepositoryLayer: Layer.Layer<DocumentArtifactRepository> =
  Layer.effect(
    DocumentArtifactRepository,
    Effect.gen(function* () {
      const documents = yield* SynchronizedRef.make(
        new Map<string, StoredDocumentArtifactValue>(),
      )

      return DocumentArtifactRepository.of({
        get: Effect.fn('DocumentArtifactRepository.get')((documentId: string) =>
          SynchronizedRef.get(documents).pipe(
            Effect.flatMap((state) => {
              const current = state.get(documentId)
              return current
                ? Effect.succeed(current.snapshot)
                : Effect.fail(new DocumentArtifactNotFoundError({ documentId }))
            }),
          ),
        ),
        initialize: Effect.fn('DocumentArtifactRepository.initialize')(
          (documentId: string, snapshot: DocumentSnapshot) =>
            SynchronizedRef.modifyEffect(documents, (state) => {
              if (state.has(documentId)) {
                return Effect.fail(
                  new DocumentArtifactAlreadyExistsError({ documentId }),
                )
              }
              const next = new Map(state)
              next.set(documentId, { snapshot, appliedOperationIds: [] })
              return Effect.succeed([snapshot, next] as const)
            }),
        ),
        transact: Effect.fn('DocumentArtifactRepository.transact')(
          (
            documentId: string,
            operationId: string,
            transition: DocumentTransition,
          ) =>
            SynchronizedRef.modifyEffect(documents, (state) => {
              const current = state.get(documentId)
              if (!current) {
                return Effect.fail(
                  new DocumentArtifactNotFoundError({ documentId }),
                )
              }
              if (current.appliedOperationIds.includes(operationId)) {
                return Effect.succeed([
                  duplicateOutcome(current.snapshot, operationId),
                  state,
                ] as const)
              }
              return transition(current.snapshot).pipe(
                Effect.map((outcome) => {
                  const next = new Map(state)
                  next.set(
                    documentId,
                    rememberOperation(current, operationId, outcome.snapshot),
                  )
                  return [outcome, next] as const
                }),
              )
            }),
        ),
      })
    }),
  )

export interface DocumentArtifactDurableStorage {
  readonly get: <T = unknown>(key: string) => Promise<T | undefined>
  readonly put: (key: string, value: unknown) => Promise<void>
}

const storageKey = (documentId: string) => `document-artifact:v1:${documentId}`

const persistenceFailure = (operation: string, cause: unknown) =>
  new DocumentArtifactPersistenceError({
    operation,
    message: `Canonical document storage failed during ${operation}.`,
    cause,
  })

/**
 * Durable Object adapter: storage is authoritative and the synchronized token
 * prevents overlapping RPC calls from interleaving read/transition/write.
 * This replaces Cloudflare Workspace Docs' custom Promise mutation queue with
 * Effect's scoped concurrency primitive.
 */
export const makeDocumentArtifactDurableRepositoryLayer = (
  storage: DocumentArtifactDurableStorage,
): Layer.Layer<DocumentArtifactRepository> =>
  Layer.effect(
    DocumentArtifactRepository,
    Effect.gen(function* () {
      const mutationToken = yield* SynchronizedRef.make(undefined)

      const readStored = Effect.fn('DocumentArtifactRepository.readStored')(
        function* (documentId: string) {
          const input = yield* Effect.tryPromise({
            try: () => storage.get(storageKey(documentId)),
            catch: (cause) => persistenceFailure('read', cause),
          })
          if (input === undefined) {
            return yield* new DocumentArtifactNotFoundError({ documentId })
          }
          return yield* Schema.decodeUnknownEffect(StoredDocumentArtifact)(
            input,
          ).pipe(
            Effect.mapError((cause) =>
              persistenceFailure('decode persisted snapshot', cause),
            ),
          )
        },
      )

      const writeStored = Effect.fn('DocumentArtifactRepository.writeStored')(
        (documentId: string, value: StoredDocumentArtifactValue) =>
          Effect.tryPromise({
            try: () => storage.put(storageKey(documentId), value),
            catch: (cause) => persistenceFailure('write', cause),
          }),
      )

      return DocumentArtifactRepository.of({
        get: Effect.fn('DocumentArtifactRepository.get')((documentId: string) =>
          readStored(documentId).pipe(Effect.map((value) => value.snapshot)),
        ),
        initialize: Effect.fn('DocumentArtifactRepository.initialize')(
          (documentId: string, snapshot: DocumentSnapshot) =>
            SynchronizedRef.modifyEffect(mutationToken, () =>
              Effect.gen(function* () {
                const existing = yield* Effect.tryPromise({
                  try: () => storage.get(storageKey(documentId)),
                  catch: (cause) => persistenceFailure('read', cause),
                })
                if (existing !== undefined) {
                  return yield* new DocumentArtifactAlreadyExistsError({
                    documentId,
                  })
                }
                yield* writeStored(documentId, {
                  snapshot,
                  appliedOperationIds: [],
                })
                return [snapshot, undefined] as const
              }),
            ),
        ),
        transact: Effect.fn('DocumentArtifactRepository.transact')(
          (
            documentId: string,
            operationId: string,
            transition: DocumentTransition,
          ) =>
            SynchronizedRef.modifyEffect(mutationToken, () =>
              Effect.gen(function* () {
                const current = yield* readStored(documentId)
                if (current.appliedOperationIds.includes(operationId)) {
                  return [
                    duplicateOutcome(current.snapshot, operationId),
                    undefined,
                  ] as const
                }
                const outcome = yield* transition(current.snapshot)
                yield* writeStored(
                  documentId,
                  rememberOperation(current, operationId, outcome.snapshot),
                )
                return [outcome, undefined] as const
              }),
            ),
        ),
      })
    }),
  )
