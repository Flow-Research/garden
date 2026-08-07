import { Clock, Context, Effect, Layer, Schema } from 'effect'
import {
  DocumentArtifactValidationError,
  DocumentBlock,
  type DocumentBlock as DocumentBlockValue,
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
  return yield* decodeDocumentSnapshot({
    revision: 1,
    title: initial.title,
    blocks: initial.blocks.map((block) => ({
      ...block,
      html: sanitizeDocumentBlockHtml(block.html),
      version: 1,
    })),
    lastModified: now,
  })
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
    const upsertIds = new Set<string>()
    for (const upsert of operation.upserts) {
      if (upsertIds.has(upsert.id)) {
        return yield* validationFailure(
          'apply operation',
          `Operation contains duplicate upsert ${upsert.id}.`,
        )
      }
      upsertIds.add(upsert.id)
    }
    const deleteIds = new Set<string>()
    for (const deletion of operation.deletes) {
      if (deleteIds.has(deletion.id)) {
        return yield* validationFailure(
          'apply operation',
          `Operation contains duplicate deletion ${deletion.id}.`,
        )
      }
      if (upsertIds.has(deletion.id)) {
        return yield* validationFailure(
          'apply operation',
          `Block ${deletion.id} cannot be upserted and deleted together.`,
        )
      }
      deleteIds.add(deletion.id)
    }
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
 * Applies the Cloudflare Workspace Docs block protocol as a pure Effect
 * transition: version conflicts are successful outcomes, non-conflicting edits
 * in the same command still commit, and ordering is last-writer-wins. Adapted
 * behavior reference: cloudflare/cloudflare-os workspace-docs.gadget at
 * f0517773aa6a2f6fbb1281ddbadcca3cb6fd2992.
 */
export const reduceDocumentOperation = Effect.fn(
  'DocumentArtifact.reduceOperation',
)(function* (
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
  if (operationTime < snapshot.lastModified) {
    return yield* validationFailure(
      'apply operation',
      'Operation time cannot predate the current document.',
    )
  }
  const nextTitle = operation.title?.trim() || snapshot.title

  const byId = new Map(snapshot.blocks.map((block) => [block.id, block]))
  const accepted: DocumentBlockValue[] = []
  const conflicts: DocumentBlockValue[] = []
  const missingIds: string[] = []
  for (const incoming of operation.upserts) {
    const current = byId.get(incoming.id)
    if (current && incoming.baseVersion !== current.version) {
      conflicts.push(current)
      continue
    }
    if (!current && incoming.baseVersion !== 0) {
      missingIds.push(incoming.id)
      continue
    }
    const next = yield* Schema.decodeUnknownEffect(DocumentBlock)({
      id: incoming.id,
      html: incoming.html,
      version: (current?.version ?? 0) + 1,
    }).pipe(
      Effect.mapError((cause) =>
        validationFailure('advance block version', String(cause)),
      ),
    )
    byId.set(next.id, next)
    accepted.push(next)
  }

  const deletedIds: string[] = []
  for (const deletion of operation.deletes) {
    const current = byId.get(deletion.id)
    if (!current) continue
    if (deletion.baseVersion !== current.version) {
      conflicts.push(current)
      continue
    }
    byId.delete(deletion.id)
    deletedIds.push(deletion.id)
  }

  const order: string[] = []
  const ordered = new Set<string>()
  for (const id of operation.order) {
    if (byId.has(id) && !ordered.has(id)) {
      order.push(id)
      ordered.add(id)
    }
  }
  for (const block of snapshot.blocks) {
    if (byId.has(block.id) && !ordered.has(block.id)) {
      order.push(block.id)
      ordered.add(block.id)
    }
  }
  for (const id of byId.keys()) {
    if (!ordered.has(id)) order.push(id)
  }

  const orderChanged =
    order.length !== snapshot.blocks.length ||
    order.some((id, index) => snapshot.blocks[index]?.id !== id)
  const changed =
    accepted.length > 0 ||
    deletedIds.length > 0 ||
    nextTitle !== snapshot.title ||
    orderChanged
  const hasConflict = conflicts.length > 0 || missingIds.length > 0
  if (!changed) {
    return hasConflict
      ? DocumentOperationOutcome.cases.Conflict.make({
          snapshot,
          accepted,
          deletedIds,
          conflicts,
          missingIds,
        })
      : DocumentOperationOutcome.cases.Unchanged.make({ snapshot })
  }

  const nextSnapshot = yield* decodeDocumentSnapshot({
    revision: snapshot.revision + 1,
    title: nextTitle,
    blocks: order
      .map((id) => byId.get(id))
      .filter((block) => block !== undefined),
    lastModified: operationTime,
  })
  return hasConflict
    ? DocumentOperationOutcome.cases.Conflict.make({
        snapshot: nextSnapshot,
        accepted,
        deletedIds,
        conflicts,
        missingIds,
      })
    : DocumentOperationOutcome.cases.Applied.make({
        snapshot: nextSnapshot,
        accepted,
        deletedIds,
      })
})

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
          (snapshot) => reduceDocumentOperation(snapshot, operation, now),
        )
      }),
    })
  }),
)
