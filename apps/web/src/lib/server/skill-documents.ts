import { Context, Effect, Layer, Schema } from 'effect'
import { parse, stringify } from 'yaml'
import {
  SkillMetadata,
  SkillValidationError,
  type SkillMetadataInput,
} from '@garden/core/skills'

export type ParsedSkillDocument = {
  readonly frontmatter: SkillMetadata
  readonly body: string
  readonly name: string
  readonly description: string
}

export interface SkillDocumentsService {
  readonly parse: (
    raw: string,
  ) => Effect.Effect<ParsedSkillDocument, SkillValidationError>
  readonly build: (input: {
    readonly name: string
    readonly description: string
    readonly body?: string
    readonly frontmatter?: SkillMetadataInput
  }) => Effect.Effect<string, SkillValidationError>
  readonly update: (input: {
    readonly raw: string
    readonly name?: string
    readonly description?: string | null
    readonly frontmatter?: SkillMetadataInput
  }) => Effect.Effect<string, SkillValidationError>
}

export class SkillDocuments extends Context.Service<
  SkillDocuments,
  SkillDocumentsService
>()('@garden/web/SkillDocuments') {}

const SKILL_DOCUMENT_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

const invalidDocument = (operation: string, message: string) =>
  new SkillValidationError({ operation, message })

const parseDocument = Effect.fn('SkillDocuments.parse')(function* (
  raw: string,
) {
  const match = raw.match(SKILL_DOCUMENT_PATTERN)
  if (!match) {
    return yield* invalidDocument(
      'parse skill document',
      'Skill document must start with YAML frontmatter',
    )
  }

  const yaml = yield* Effect.try({
    try: () => parse(match[1] ?? ''),
    catch: (cause) =>
      invalidDocument(
        'parse skill document',
        cause instanceof Error
          ? cause.message
          : 'Skill frontmatter is invalid YAML',
      ),
  })
  const frontmatter = yield* Schema.decodeUnknownEffect(SkillMetadata)(
    yaml,
  ).pipe(
    Effect.mapError(() =>
      invalidDocument(
        'parse skill document',
        'Skill frontmatter must include name and description',
      ),
    ),
  )

  return {
    frontmatter,
    body: match[2] ?? '',
    name: frontmatter.name,
    description: frontmatter.description,
  }
})

const serializeDocument = Effect.fn('SkillDocuments.serialize')(function* (
  frontmatter: SkillMetadata,
  body: string,
) {
  const yaml = yield* Effect.try({
    try: () => stringify(frontmatter).trim(),
    catch: (cause) =>
      invalidDocument(
        'serialize skill document',
        cause instanceof Error
          ? cause.message
          : 'Skill frontmatter could not be serialized',
      ),
  })
  return `---\n${yaml}\n---\n\n${body}`
})

const buildDocument = Effect.fn('SkillDocuments.build')(function* (input: {
  readonly name: string
  readonly description: string
  readonly body?: string
  readonly frontmatter?: SkillMetadataInput
}) {
  const frontmatter = yield* Schema.decodeUnknownEffect(SkillMetadata)({
    ...input.frontmatter,
    name: input.name,
    description: input.description,
  }).pipe(
    Effect.mapError(() =>
      invalidDocument(
        'build skill document',
        'Skill name and description are required',
      ),
    ),
  )
  return yield* serializeDocument(frontmatter, input.body ?? '')
})

const updateDocument = Effect.fn('SkillDocuments.update')(function* (input: {
  readonly raw: string
  readonly name?: string
  readonly description?: string | null
  readonly frontmatter?: SkillMetadataInput
}) {
  const current = yield* parseDocument(input.raw)
  const description = input.description ?? current.description
  if (!description.trim()) {
    return yield* invalidDocument(
      'update skill document',
      'Skill description is required',
    )
  }

  const frontmatter = yield* Schema.decodeUnknownEffect(SkillMetadata)({
    compatibility:
      input.frontmatter?.compatibility ?? current.frontmatter.compatibility,
    license: input.frontmatter?.license ?? current.frontmatter.license,
    'allowed-tools':
      input.frontmatter?.['allowed-tools'] ??
      current.frontmatter['allowed-tools'],
    metadata: input.frontmatter?.metadata ?? current.frontmatter.metadata,
    ...(current.frontmatter.import
      ? { import: current.frontmatter.import }
      : {}),
    name: input.name ?? current.name,
    description,
  }).pipe(
    Effect.mapError(() =>
      invalidDocument(
        'update skill document',
        'Skill name and description are required',
      ),
    ),
  )

  return yield* serializeDocument(frontmatter, current.body)
})

/** Parses and rewrites only supported Agent Skills frontmatter fields. */
export const skillDocumentsLayer = Layer.succeed(
  SkillDocuments,
  SkillDocuments.of({
    parse: parseDocument,
    build: buildDocument,
    update: updateDocument,
  }),
)
