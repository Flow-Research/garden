import { Schema } from 'effect'

export const MAX_DOCUMENT_BLOCK_ID_LENGTH = 100
export const MAX_DOCUMENT_BLOCK_HTML_LENGTH = 10_000_000
export const MAX_DOCUMENT_TITLE_LENGTH = 500

/** Non-blank authority key accepted by the document service and RPC layer. */
export const DocumentArtifactId = Schema.String.check(Schema.isPattern(/\S/))

/** Safe, persisted revision. Canonical snapshots begin at revision one. */
export const DocumentRevision = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1),
)

/** Client revision/version fence; zero represents a not-yet-created value. */
export const DocumentBaseRevision = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
)

/** Epoch-millisecond timestamp stored in canonical snapshots. */
export const DocumentTimestamp = Schema.Finite.check(
  Schema.isGreaterThanOrEqualTo(0),
)

export const DocumentBlockId = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(MAX_DOCUMENT_BLOCK_ID_LENGTH),
)

export const DocumentBlockHtml = Schema.String.check(
  Schema.isMaxLength(MAX_DOCUMENT_BLOCK_HTML_LENGTH),
)

export const DocumentTitle = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(MAX_DOCUMENT_TITLE_LENGTH),
)

const DocumentTitleUpdate = Schema.String.check(
  Schema.isMaxLength(MAX_DOCUMENT_TITLE_LENGTH),
)
const DocumentOperationId = Schema.String.check(Schema.isPattern(/\S/))
const DocumentSenderId = Schema.String.check(Schema.isPattern(/\S/))

export const DocumentBlock = Schema.Struct({
  id: DocumentBlockId,
  html: DocumentBlockHtml,
  version: DocumentRevision,
})
export type DocumentBlock = typeof DocumentBlock.Type

export const DocumentSnapshot = Schema.Struct({
  revision: DocumentRevision,
  title: DocumentTitle,
  blocks: Schema.Array(DocumentBlock),
  lastModified: DocumentTimestamp,
})
export type DocumentSnapshot = typeof DocumentSnapshot.Type

export const DocumentBlockUpsert = Schema.Struct({
  id: DocumentBlockId,
  html: DocumentBlockHtml,
  baseVersion: DocumentBaseRevision,
})
export type DocumentBlockUpsert = typeof DocumentBlockUpsert.Type

export const DocumentBlockDeletion = Schema.Struct({
  id: DocumentBlockId,
  baseVersion: DocumentBaseRevision,
})
export type DocumentBlockDeletion = typeof DocumentBlockDeletion.Type

export const DocumentOperation = Schema.Struct({
  operationId: DocumentOperationId,
  senderId: DocumentSenderId,
  baseRevision: DocumentBaseRevision,
  upserts: Schema.Array(DocumentBlockUpsert),
  deletes: Schema.Array(DocumentBlockDeletion),
  order: Schema.Array(DocumentBlockId),
  title: Schema.optionalKey(DocumentTitleUpdate),
})
export type DocumentOperation = typeof DocumentOperation.Type

export const InitialDocument = Schema.Struct({
  title: DocumentTitle,
  blocks: Schema.Array(
    Schema.Struct({
      id: DocumentBlockId,
      html: DocumentBlockHtml,
    }),
  ),
})
export type InitialDocument = typeof InitialDocument.Type

export const DocumentOperationOutcome = Schema.TaggedUnion({
  Applied: {
    snapshot: DocumentSnapshot,
    accepted: Schema.Array(DocumentBlock),
    deletedIds: Schema.Array(DocumentBlockId),
  },
  Conflict: {
    snapshot: DocumentSnapshot,
    accepted: Schema.Array(DocumentBlock),
    deletedIds: Schema.Array(DocumentBlockId),
    conflicts: Schema.Array(DocumentBlock),
    missingIds: Schema.Array(DocumentBlockId),
  },
  Unchanged: { snapshot: DocumentSnapshot },
  Duplicate: {
    snapshot: DocumentSnapshot,
    operationId: DocumentOperationId,
  },
})
export type DocumentOperationOutcome = typeof DocumentOperationOutcome.Type

export const StoredDocumentArtifact = Schema.Struct({
  snapshot: DocumentSnapshot,
  appliedOperationIds: Schema.Array(DocumentOperationId),
})
export type StoredDocumentArtifact = typeof StoredDocumentArtifact.Type

/** Invalid persisted state or a malformed document command. */
export class DocumentArtifactValidationError extends Schema.TaggedErrorClass<DocumentArtifactValidationError>()(
  'DocumentArtifactValidationError',
  {
    operation: Schema.String,
    message: Schema.String,
  },
) {}

/** Recoverable durable-storage failure surfaced to the application boundary. */
export class DocumentArtifactPersistenceError extends Schema.TaggedErrorClass<DocumentArtifactPersistenceError>()(
  'DocumentArtifactPersistenceError',
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

/** The requested canonical document has not been initialized in this authority. */
export class DocumentArtifactNotFoundError extends Schema.TaggedErrorClass<DocumentArtifactNotFoundError>()(
  'DocumentArtifactNotFoundError',
  { documentId: DocumentArtifactId },
) {}

/** Canonical state already exists and must be changed through operations. */
export class DocumentArtifactAlreadyExistsError extends Schema.TaggedErrorClass<DocumentArtifactAlreadyExistsError>()(
  'DocumentArtifactAlreadyExistsError',
  { documentId: DocumentArtifactId },
) {}

export type DocumentArtifactError =
  | DocumentArtifactValidationError
  | DocumentArtifactPersistenceError
  | DocumentArtifactNotFoundError
  | DocumentArtifactAlreadyExistsError

/** Serializable failure envelope used across the AgentDO RPC boundary. */
export const DocumentArtifactRpcError = Schema.TaggedUnion({
  DocumentArtifactValidationError: { message: Schema.String },
  DocumentArtifactPersistenceError: {},
  DocumentArtifactNotFoundError: {},
  DocumentArtifactAlreadyExistsError: {},
  DocumentArtifactImportError: {},
})
export type DocumentArtifactRpcError = typeof DocumentArtifactRpcError.Type

type DocumentArtifactRpcSourceError =
  | DocumentArtifactError
  | { readonly _tag: 'DocumentArtifactImportError' }

/** Converts domain failures into the explicit wire union used by AgentDO RPC. */
export const toDocumentArtifactRpcError = (
  error: DocumentArtifactRpcSourceError,
): DocumentArtifactRpcError =>
  DocumentArtifactRpcError.match<DocumentArtifactRpcError>(error, {
    DocumentArtifactValidationError: ({ message }) =>
      DocumentArtifactRpcError.cases.DocumentArtifactValidationError.make({
        message,
      }),
    DocumentArtifactPersistenceError: () =>
      DocumentArtifactRpcError.cases.DocumentArtifactPersistenceError.make({}),
    DocumentArtifactNotFoundError: () =>
      DocumentArtifactRpcError.cases.DocumentArtifactNotFoundError.make({}),
    DocumentArtifactAlreadyExistsError: () =>
      DocumentArtifactRpcError.cases.DocumentArtifactAlreadyExistsError.make(
        {},
      ),
    DocumentArtifactImportError: () =>
      DocumentArtifactRpcError.cases.DocumentArtifactImportError.make({}),
  })
