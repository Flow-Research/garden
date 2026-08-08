import { Context, Effect, Layer, Schema, SynchronizedRef } from 'effect'
import {
  DocumentArtifactAlreadyExistsError,
  type DocumentArtifactError,
  DocumentArtifactNotFoundError,
  DocumentArtifactPersistenceError,
  DocumentOperationId,
  DocumentOperationOutcome,
  type DocumentOperationOutcome as DocumentOperationOutcomeValue,
  DocumentSnapshot,
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

interface StoredDocumentArtifact {
  readonly document: DocumentSnapshot
  readonly appliedOperationIds: ReadonlyArray<string>
}

const rememberOperation = (
  current: StoredDocumentArtifact,
  operationId: string,
  document: DocumentSnapshot,
): StoredDocumentArtifact => ({
  document,
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
        new Map<string, StoredDocumentArtifact>(),
      )

      return DocumentArtifactRepository.of({
        get: Effect.fn('DocumentArtifactRepository.get')((documentId: string) =>
          SynchronizedRef.get(documents).pipe(
            Effect.flatMap((state) => {
              const current = state.get(documentId)
              return current
                ? Effect.succeed(current.document)
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
              next.set(documentId, {
                document: snapshot,
                appliedOperationIds: [],
              })
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
                  duplicateOutcome(current.document, operationId),
                  state,
                ] as const)
              }
              return transition(current.document).pipe(
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
  readonly get: (key: string) => Promise<unknown | undefined>
  readonly put: (entries: Record<string, unknown>) => Promise<void>
}

const documentStorageKey = (documentId: string) => `document:v2:${documentId}`
const operationIdsStorageKey = (documentId: string) =>
  `document:operation-ids:v1:${documentId}`

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
          const [documentInput, operationIdsInput] = yield* Effect.tryPromise({
            try: () =>
              Promise.all([
                storage.get(documentStorageKey(documentId)),
                storage.get(operationIdsStorageKey(documentId)),
              ]),
            catch: (cause) => persistenceFailure('read', cause),
          })
          if (documentInput === undefined) {
            return yield* new DocumentArtifactNotFoundError({ documentId })
          }
          const document = yield* Schema.decodeUnknownEffect(DocumentSnapshot)(
            documentInput,
          ).pipe(
            Effect.mapError((cause) =>
              persistenceFailure('decode persisted document', cause),
            ),
          )
          const appliedOperationIds =
            operationIdsInput === undefined
              ? []
              : yield* Schema.decodeUnknownEffect(
                  Schema.Array(DocumentOperationId),
                )(operationIdsInput).pipe(
                  Effect.mapError((cause) =>
                    persistenceFailure('decode persisted operation ids', cause),
                  ),
                )
          return { document, appliedOperationIds }
        },
      )

      const writeStored = Effect.fn('DocumentArtifactRepository.writeStored')(
        (documentId: string, value: StoredDocumentArtifact) =>
          Effect.tryPromise({
            try: () =>
              storage.put({
                [documentStorageKey(documentId)]: value.document,
                [operationIdsStorageKey(documentId)]: value.appliedOperationIds,
              }),
            catch: (cause) => persistenceFailure('write', cause),
          }),
      )

      return DocumentArtifactRepository.of({
        get: Effect.fn('DocumentArtifactRepository.get')((documentId: string) =>
          readStored(documentId).pipe(Effect.map((value) => value.document)),
        ),
        initialize: Effect.fn('DocumentArtifactRepository.initialize')(
          (documentId: string, snapshot: DocumentSnapshot) =>
            SynchronizedRef.modifyEffect(mutationToken, () =>
              Effect.gen(function* () {
                const existing = yield* Effect.tryPromise({
                  try: () => storage.get(documentStorageKey(documentId)),
                  catch: (cause) => persistenceFailure('read', cause),
                })
                if (existing !== undefined) {
                  return yield* new DocumentArtifactAlreadyExistsError({
                    documentId,
                  })
                }
                yield* writeStored(documentId, {
                  document: snapshot,
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
                    duplicateOutcome(current.document, operationId),
                    undefined,
                  ] as const
                }
                const outcome = yield* transition(current.document)
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
