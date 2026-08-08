import { Clock, Context, Effect, Layer, Schema } from 'effect'
import {
  applyOperation as applyWorkspaceDocsOperation,
  setDocument as setWorkspaceDocsDocument,
} from '../../../../third_party/cloudflare-os/workspace-docs/server-authority'
import {
  DocumentArtifactValidationError,
  DocumentOperation,
  type DocumentOperation as DocumentOperationValue,
  DocumentOperationOutcome,
  type DocumentOperationOutcome as DocumentOperationOutcomeValue,
  DocumentSnapshot,
  type DocumentSnapshot as DocumentSnapshotValue,
  DocumentTimestamp,
  InitialDocument,
  type DocumentArtifactError,
} from './document-artifact-model'
import { DocumentArtifactRepository } from './document-artifact-repository'
import { sanitizeDocumentBlockHtml } from './document-artifact-projection'

const validationFailure = (operation: string, message: string) =>
  new DocumentArtifactValidationError({ operation, message })

/** Decodes durable state once and rejects corrupt revision/block invariants. */
export const decodeDocumentSnapshot = Effect.fn(
  'DocumentArtifact.decodeSnapshot',
)(function* (input: unknown) {
  const snapshot = yield* Schema.decodeUnknownEffect(DocumentSnapshot)(
    input,
  ).pipe(
    Effect.mapError((cause) =>
      validationFailure('decode snapshot', String(cause)),
    ),
  )
  const ids = new Set<string>()
  for (const block of snapshot.blocks) {
    if (ids.has(block.id)) {
      return yield* validationFailure(
        'decode snapshot',
        `Document contains duplicate block id ${block.id}.`,
      )
    }
    ids.add(block.id)
  }
  return snapshot
})

/** Builds version-one canonical state from an importer or agent document. */
export const createDocumentSnapshot = Effect.fn(
  'DocumentArtifact.createSnapshot',
)(function* (input: unknown, now: number) {
  const initial = yield* Schema.decodeUnknownEffect(InitialDocument)(
    input,
  ).pipe(
    Effect.mapError((cause) =>
      validationFailure('create snapshot', String(cause)),
    ),
  )
  return yield* decodeDocumentSnapshot(
    setWorkspaceDocsDocument(
      undefined,
      {
        title: initial.title,
        blocks: initial.blocks.map((block) => ({
          ...block,
          html: sanitizeDocumentBlockHtml(block.html),
        })),
      },
      now,
    ),
  )
})

const decodeOperation = Effect.fn('DocumentArtifact.decodeOperation')(
  function* (input: unknown) {
    const operation = yield* Schema.decodeUnknownEffect(DocumentOperation)(
      input,
    ).pipe(
      Effect.mapError((cause) =>
        validationFailure('apply operation', String(cause)),
      ),
    )
    return yield* Schema.decodeUnknownEffect(DocumentOperation)({
      ...operation,
      upserts: operation.upserts.map((upsert) => ({
        ...upsert,
        html: sanitizeDocumentBlockHtml(upsert.html),
      })),
    }).pipe(
      Effect.mapError((cause) =>
        validationFailure('sanitize operation', String(cause)),
      ),
    )
  },
)

/**
 * Validates the result of the vendored Cloudflare OS authority and translates
 * its RPC-shaped status into Garden's typed Effect outcome. The mutation itself
 * remains in the attributed `server-authority.ts` adaptation beside upstream.
 */
const applyDocumentOperation = Effect.fn('DocumentArtifact.applyOperation')(
  function* (
    snapshotInput: unknown,
    operation: DocumentOperationValue,
    now: number,
  ) {
    const snapshot = yield* decodeDocumentSnapshot(snapshotInput)
    const operationTime = yield* Schema.decodeUnknownEffect(DocumentTimestamp)(
      now,
    ).pipe(
      Effect.mapError((cause) =>
        validationFailure('apply operation', String(cause)),
      ),
    )
    const transition = applyWorkspaceDocsOperation(
      snapshot,
      operation,
      operationTime,
    )
    const nextSnapshot = yield* decodeDocumentSnapshot(transition.document)
    const result = transition.result
    if (!('type' in result)) {
      return result.status === 'conflict'
        ? DocumentOperationOutcome.cases.Conflict.make({
            snapshot: nextSnapshot,
            committed: false,
            accepted: [],
            deletedIds: [],
            conflicts: result.conflicts,
          })
        : DocumentOperationOutcome.cases.Unchanged.make({
            snapshot: nextSnapshot,
          })
    }
    return result.status === 'conflict'
      ? DocumentOperationOutcome.cases.Conflict.make({
          snapshot: nextSnapshot,
          committed: true,
          accepted: result.upserts,
          deletedIds: result.deletedIds,
          conflicts: result.conflicts,
        })
      : DocumentOperationOutcome.cases.Applied.make({
          snapshot: nextSnapshot,
          accepted: result.upserts,
          deletedIds: result.deletedIds,
        })
  },
)

export interface DocumentArtifactEngineService {
  readonly get: (
    documentId: string,
  ) => Effect.Effect<DocumentSnapshotValue, DocumentArtifactError>
  readonly initialize: (
    documentId: string,
    input: unknown,
  ) => Effect.Effect<DocumentSnapshotValue, DocumentArtifactError>
  readonly apply: (
    documentId: string,
    input: unknown,
  ) => Effect.Effect<DocumentOperationOutcomeValue, DocumentArtifactError>
}

/** Canonical document domain service; Promise conversion belongs at RPC edges. */
export class DocumentArtifactEngine extends Context.Service<
  DocumentArtifactEngine,
  DocumentArtifactEngineService
>()('@garden/documents/DocumentArtifactEngine') {}

/** Composes validation, clock, and atomic persistence into the public engine. */
export const documentArtifactEngineLayer: Layer.Layer<
  DocumentArtifactEngine,
  never,
  DocumentArtifactRepository
> = Layer.effect(
  DocumentArtifactEngine,
  Effect.gen(function* () {
    const repository = yield* DocumentArtifactRepository
    return DocumentArtifactEngine.of({
      get: repository.get,
      initialize: Effect.fn('DocumentArtifactEngine.initialize')(function* (
        documentId: string,
        input: unknown,
      ) {
        const now = yield* Clock.currentTimeMillis
        const snapshot = yield* createDocumentSnapshot(input, now)
        return yield* repository.initialize(documentId, snapshot)
      }),
      apply: Effect.fn('DocumentArtifactEngine.apply')(function* (
        documentId: string,
        input: unknown,
      ) {
        const operation = yield* decodeOperation(input)
        const now = yield* Clock.currentTimeMillis
        return yield* repository.transact(
          documentId,
          operation.operationId,
          (snapshot) => applyDocumentOperation(snapshot, operation, now),
        )
      }),
    })
  }),
)
