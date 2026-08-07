import {
  DocumentArtifactNotFoundError,
  DocumentArtifactValidationError,
  DocumentOperation,
  DocumentOperationOutcome,
  DocumentSnapshot,
} from '@garden/agent-runtime/src/documents/document-artifact-model'
import { Schema } from 'effect'
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from 'effect/unstable/httpapi'

const DocumentArtifactId = Schema.String.pipe(Schema.check(Schema.isUUID()))

export const DocumentArtifactParams = Schema.Struct({ id: DocumentArtifactId })

export class DocumentArtifactUnauthorizedError extends Schema.TaggedErrorClass<DocumentArtifactUnauthorizedError>()(
  'DocumentArtifactUnauthorizedError',
  { message: Schema.String },
) {}

export class DocumentArtifactForbiddenError extends Schema.TaggedErrorClass<DocumentArtifactForbiddenError>()(
  'DocumentArtifactForbiddenError',
  { message: Schema.String },
) {}

export class DocumentArtifactOperationError extends Schema.TaggedErrorClass<DocumentArtifactOperationError>()(
  'DocumentArtifactOperationError',
  { operation: Schema.String, message: Schema.String },
) {}

const ValidationError = DocumentArtifactValidationError.pipe(
  HttpApiSchema.status(400),
)
const UnauthorizedError = DocumentArtifactUnauthorizedError.pipe(
  HttpApiSchema.status(401),
)
const ForbiddenError = DocumentArtifactForbiddenError.pipe(
  HttpApiSchema.status(403),
)
const NotFoundError = DocumentArtifactNotFoundError.pipe(
  HttpApiSchema.status(404),
)
const OperationError = DocumentArtifactOperationError.pipe(
  HttpApiSchema.status(500),
)
const CommonErrors = [
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  OperationError,
] as const

/**
 * Canonical editable-document HTTP contract. The route carries only the
 * document id because authorization resolves the owning chat facet before RPC.
 */
export const DocumentArtifactsApiGroup = HttpApiGroup.make('documentArtifacts')
  .add(
    HttpApiEndpoint.get('get', '/api/documents/:id/artifact', {
      params: DocumentArtifactParams,
      success: DocumentSnapshot,
      error: CommonErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post('apply', '/api/documents/:id/artifact', {
      params: DocumentArtifactParams,
      payload: DocumentOperation,
      success: DocumentOperationOutcome,
      error: CommonErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get('events', '/api/documents/:id/artifact/events', {
      params: DocumentArtifactParams,
      success: HttpApiSchema.Empty(200),
      error: CommonErrors,
    }),
  )

export const GardenDocumentsApi = HttpApi.make('garden').add(
  DocumentArtifactsApiGroup,
)
