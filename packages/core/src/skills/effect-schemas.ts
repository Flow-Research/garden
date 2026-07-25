import { Schema } from 'effect'

const NonEmptyTrimmedString = Schema.Trim.pipe(
  Schema.check(Schema.isMinLength(1)),
)

export const SkillSourceType = Schema.Literals([
  'manual',
  'skills.sh',
  'builtin',
])
export type SkillSourceType = typeof SkillSourceType.Type

export const SkillImportMetadata = Schema.Struct({
  provider: Schema.Literal('skills.sh'),
  owner: NonEmptyTrimmedString,
  repo: NonEmptyTrimmedString,
  skill: NonEmptyTrimmedString,
  source: NonEmptyTrimmedString,
})
export type SkillImportMetadata = typeof SkillImportMetadata.Type

export const SkillMetadataDetails = Schema.Struct({
  version: Schema.optional(NonEmptyTrimmedString),
  tier: Schema.optional(NonEmptyTrimmedString),
  category: Schema.optional(NonEmptyTrimmedString),
  tags: Schema.optional(Schema.mutable(Schema.Array(NonEmptyTrimmedString))),
})
export type SkillMetadataDetails = typeof SkillMetadataDetails.Type

/** Supported Agent Skills frontmatter. Unknown YAML keys are intentionally omitted. */
export const SkillMetadata = Schema.Struct({
  name: NonEmptyTrimmedString,
  description: NonEmptyTrimmedString,
  compatibility: Schema.optional(NonEmptyTrimmedString),
  license: Schema.optional(NonEmptyTrimmedString),
  'allowed-tools': Schema.optional(NonEmptyTrimmedString),
  metadata: Schema.optional(SkillMetadataDetails),
  import: Schema.optional(SkillImportMetadata),
})
export type SkillMetadata = typeof SkillMetadata.Type

/** Mutable metadata accepted by create and update requests; name and description use dedicated fields. */
export const SkillMetadataInput = Schema.Struct({
  compatibility: Schema.optional(NonEmptyTrimmedString),
  license: Schema.optional(NonEmptyTrimmedString),
  'allowed-tools': Schema.optional(NonEmptyTrimmedString),
  metadata: Schema.optional(SkillMetadataDetails),
})
export type SkillMetadataInput = typeof SkillMetadataInput.Type

export const SkillFileInput = Schema.Struct({
  path: NonEmptyTrimmedString,
  content: Schema.String,
})
export type SkillFileInput = typeof SkillFileInput.Type

export const SkillFile = Schema.Struct({
  id: Schema.String,
  skill_id: Schema.String,
  path: Schema.String,
  content: Schema.String,
  content_hash: Schema.NullOr(Schema.String),
  r2_key: Schema.NullOr(Schema.String),
  created_at: Schema.String,
  updated_at: Schema.String,
})
export type SkillFile = typeof SkillFile.Type

export const Skill = Schema.Struct({
  id: Schema.String,
  workspace_id: Schema.String,
  slug: Schema.String,
  name: Schema.String,
  description: Schema.String,
  content: Schema.String,
  config: SkillMetadata,
  files: Schema.mutable(Schema.Array(SkillFile)),
  source_type: SkillSourceType,
  source_url: Schema.NullOr(Schema.String),
  bundle_hash: Schema.NullOr(Schema.String),
  created_by: Schema.NullOr(Schema.String),
  created_at: Schema.String,
  updated_at: Schema.String,
})
export type Skill = typeof Skill.Type

export const AgentSkill = Schema.Struct({
  ...Skill.fields,
  enabled: Schema.Boolean,
})
export type AgentSkill = typeof AgentSkill.Type

export const AgentSkillAssignment = Schema.Struct({
  skill_id: Schema.String,
  enabled: Schema.Boolean,
})
export type AgentSkillAssignment = typeof AgentSkillAssignment.Type

export const CreateSkillRequest = Schema.Struct({
  name: NonEmptyTrimmedString,
  description: Schema.optional(Schema.NullOr(NonEmptyTrimmedString)),
  content: Schema.optional(Schema.String),
  config: Schema.optional(SkillMetadataInput),
  files: Schema.optional(Schema.mutable(Schema.Array(SkillFileInput))),
})
export type CreateSkillRequest = typeof CreateSkillRequest.Type

export const UpdateSkillRequest = Schema.Struct({
  name: Schema.optional(NonEmptyTrimmedString),
  description: Schema.optional(Schema.NullOr(NonEmptyTrimmedString)),
  content: Schema.optional(Schema.String),
  config: Schema.optional(SkillMetadataInput),
  files: Schema.optional(Schema.mutable(Schema.Array(SkillFileInput))),
})
export type UpdateSkillRequest = typeof UpdateSkillRequest.Type

export const ImportSkillRequest = Schema.Union([
  Schema.Struct({ url: NonEmptyTrimmedString }),
  Schema.Struct({
    source: NonEmptyTrimmedString,
    skill: NonEmptyTrimmedString,
  }),
])
export type ImportSkillRequest = typeof ImportSkillRequest.Type

export const SetAgentSkillsRequest = Schema.Struct({
  skills: Schema.mutable(Schema.Array(AgentSkillAssignment)),
})
export type SetAgentSkillsRequest = typeof SetAgentSkillsRequest.Type

export const SearchSkillsRequest = Schema.Struct({
  q: Schema.optional(Schema.Trim),
  limit: Schema.optional(
    Schema.Int.check(
      Schema.isGreaterThan(0),
      Schema.isLessThanOrEqualTo(50),
    ),
  ),
})
export type SearchSkillsRequest = typeof SearchSkillsRequest.Type

export const SkillsShSearchResult = Schema.Struct({
  id: Schema.String,
  skill_id: Schema.String,
  name: Schema.String,
  installs: Schema.Number,
  source: Schema.String,
})
export type SkillsShSearchResult = typeof SkillsShSearchResult.Type

export const SkillPreview = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  slug: Schema.String,
  content: Schema.String,
  files: Schema.mutable(Schema.Array(SkillFileInput)),
  source_url: Schema.String,
  bundle_hash: Schema.String,
})
export type SkillPreview = typeof SkillPreview.Type

export const SkillIdParams = Schema.Struct({ id: Schema.String })
export const AgentIdParams = Schema.Struct({ id: Schema.String })

export class SkillValidationError extends Schema.TaggedErrorClass<SkillValidationError>()(
  'SkillValidationError',
  { operation: Schema.String, message: Schema.String },
) {}

export class SkillUnauthorizedError extends Schema.TaggedErrorClass<SkillUnauthorizedError>()(
  'SkillUnauthorizedError',
  { message: Schema.String },
) {}

export class SkillForbiddenError extends Schema.TaggedErrorClass<SkillForbiddenError>()(
  'SkillForbiddenError',
  { message: Schema.String },
) {}

export class SkillNotFoundError extends Schema.TaggedErrorClass<SkillNotFoundError>()(
  'SkillNotFoundError',
  { resource: Schema.String, id: Schema.String, message: Schema.String },
) {}

export class SkillConflictError extends Schema.TaggedErrorClass<SkillConflictError>()(
  'SkillConflictError',
  { resource: Schema.String, id: Schema.String, message: Schema.String },
) {}

export class SkillOperationError extends Schema.TaggedErrorClass<SkillOperationError>()(
  'SkillOperationError',
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export type SkillError =
  | SkillValidationError
  | SkillUnauthorizedError
  | SkillForbiddenError
  | SkillNotFoundError
  | SkillConflictError
  | SkillOperationError
