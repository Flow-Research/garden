import { Schema } from 'effect'

export const MAX_DOCUMENT_BLOCK_ID_LENGTH = 100
export const MAX_DOCUMENT_BLOCK_HTML_LENGTH = 10_000_000
export const MAX_DOCUMENT_TITLE_LENGTH = 500

export const DocumentBlock = Schema.Struct({
  id: Schema.String,
  html: Schema.String,
  version: Schema.Number,
})
export type DocumentBlock = typeof DocumentBlock.Type

export const DocumentSnapshot = Schema.Struct({
  revision: Schema.Number,
  title: Schema.String,
  blocks: Schema.Array(DocumentBlock),
  lastModified: Schema.Number,
})
export type DocumentSnapshot = typeof DocumentSnapshot.Type

export const DocumentBlockUpsert = Schema.Struct({
  id: Schema.String,
  html: Schema.String,
  baseVersion: Schema.Number,
})
export type DocumentBlockUpsert = typeof DocumentBlockUpsert.Type

export const DocumentBlockDeletion = Schema.Struct({
  id: Schema.String,
  baseVersion: Schema.Number,
})
export type DocumentBlockDeletion = typeof DocumentBlockDeletion.Type

export const DocumentOperation = Schema.Struct({
  operationId: Schema.String,
  senderId: Schema.String,
  baseRevision: Schema.Number,
  upserts: Schema.Array(DocumentBlockUpsert),
  deletes: Schema.Array(DocumentBlockDeletion),
  order: Schema.Array(Schema.String),
  title: Schema.optionalKey(Schema.String),
})
export type DocumentOperation = typeof DocumentOperation.Type

export const InitialDocument = Schema.Struct({
  title: Schema.String,
  blocks: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      html: Schema.String,
    }),
  ),
})
export type InitialDocument = typeof InitialDocument.Type

export const DocumentOperationOutcome = Schema.TaggedUnion({
  Applied: {
    snapshot: DocumentSnapshot,
    accepted: Schema.Array(DocumentBlock),
    deletedIds: Schema.Array(Schema.String),
  },
  Conflict: {
    snapshot: DocumentSnapshot,
    accepted: Schema.Array(DocumentBlock),
    deletedIds: Schema.Array(Schema.String),
    conflicts: Schema.Array(DocumentBlock),
    missingIds: Schema.Array(Schema.String),
  },
  Unchanged: { snapshot: DocumentSnapshot },
  Duplicate: {
    snapshot: DocumentSnapshot,
    operationId: Schema.String,
  },
})
export type DocumentOperationOutcome = typeof DocumentOperationOutcome.Type

export const StoredDocumentArtifact = Schema.Struct({
  snapshot: DocumentSnapshot,
  appliedOperationIds: Schema.Array(Schema.String),
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
  { documentId: Schema.String },
) {}

/** Canonical state already exists and must be changed through operations. */
export class DocumentArtifactAlreadyExistsError extends Schema.TaggedErrorClass<DocumentArtifactAlreadyExistsError>()(
  'DocumentArtifactAlreadyExistsError',
  { documentId: Schema.String },
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
