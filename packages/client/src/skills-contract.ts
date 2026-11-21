import {
  AgentIdParams,
  AgentSkill,
  CreateSkillRequest,
  ImportSkillRequest,
  SearchSkillsRequest,
  SetAgentSkillsRequest,
  Skill,
  SkillConflictError,
  SkillForbiddenError,
  SkillIdParams,
  SkillNotFoundError,
  SkillOperationError,
  SkillPreview,
  SkillsShSearchResult,
  SkillUnauthorizedError,
  SkillValidationError,
  UpdateSkillRequest,
} from '@garden/core/skills'
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from 'effect/unstable/httpapi'
import { Schema } from 'effect'

const ValidationError = SkillValidationError.pipe(HttpApiSchema.status(400))
const UnauthorizedError = SkillUnauthorizedError.pipe(HttpApiSchema.status(401))
const ForbiddenError = SkillForbiddenError.pipe(HttpApiSchema.status(403))
const NotFoundError = SkillNotFoundError.pipe(HttpApiSchema.status(404))
const ConflictError = SkillConflictError.pipe(HttpApiSchema.status(409))
const OperationError = SkillOperationError.pipe(HttpApiSchema.status(500))
const CommonErrors = [
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  OperationError,
] as const

export const SkillsApiGroup = HttpApiGroup.make('skills').add(
  HttpApiEndpoint.get('list', '/api/skills', {
    success: Schema.mutable(Schema.Array(Skill)),
    error: CommonErrors,
  }),
  HttpApiEndpoint.post('create', '/api/skills', {
    payload: CreateSkillRequest,
    success: Skill.pipe(HttpApiSchema.status(201)),
    error: CommonErrors,
  }),
  HttpApiEndpoint.get('get', '/api/skills/:id', {
    params: SkillIdParams,
    success: Skill,
    error: CommonErrors,
  }),
  HttpApiEndpoint.patch('update', '/api/skills/:id', {
    params: SkillIdParams,
    payload: UpdateSkillRequest,
    success: Skill,
    error: CommonErrors,
  }),
  HttpApiEndpoint.put('replace', '/api/skills/:id', {
    params: SkillIdParams,
    payload: UpdateSkillRequest,
    success: Skill,
    error: CommonErrors,
  }),
  HttpApiEndpoint.delete('remove', '/api/skills/:id', {
    params: SkillIdParams,
    success: HttpApiSchema.NoContent,
    error: CommonErrors,
  }),
  HttpApiEndpoint.post('import', '/api/skills/import', {
    payload: ImportSkillRequest,
    success: Skill,
    error: CommonErrors,
  }),
  HttpApiEndpoint.get('search', '/api/skills/search', {
    query: SearchSkillsRequest,
    success: Schema.mutable(Schema.Array(SkillsShSearchResult)),
    error: CommonErrors,
  }),
  HttpApiEndpoint.post('preview', '/api/skills/preview', {
    payload: ImportSkillRequest,
    success: SkillPreview,
    error: CommonErrors,
  }),
  HttpApiEndpoint.get('listAgentAssignments', '/api/agents/:id/skills', {
    params: AgentIdParams,
    success: Schema.mutable(Schema.Array(AgentSkill)),
    error: CommonErrors,
  }),
  HttpApiEndpoint.put('setAgentAssignments', '/api/agents/:id/skills', {
    params: AgentIdParams,
    payload: SetAgentSkillsRequest,
    success: HttpApiSchema.NoContent,
    error: CommonErrors,
  }),
)

export const GardenSkillsApi = HttpApi.make('garden').add(SkillsApiGroup)
