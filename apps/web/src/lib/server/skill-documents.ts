import { Result, TaggedError } from 'better-result'
import { parse, stringify } from 'yaml'

export class SkillDocumentError extends TaggedError('SkillDocumentError')<{
  message: string
  phase: 'parse' | 'validate'
}>() {}

export type ParsedSkillDocument = {
  frontmatter: Record<string, unknown>
  body: string
  name: string
  description: string
}

const SKILL_DOCUMENT_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requiredString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeFrontmatter(value: unknown) {
  return isRecord(value) ? value : {}
}

/**
 * Parses Garden skill documents using the same contract as `agents/skills`:
 * one skill directory has a `SKILL.md` with YAML frontmatter, and the `name`
 * plus `description` fields are required for Think's catalog. Garden persists
 * the raw SKILL.md to R2 for runtime use; Postgres stores only parsed catalog
 * fields and JSON metadata, so raw YAML never lands in `skill.frontmatter`.
 * Source checked: installed `agents/skills` parser and Cloudflare Agent Skills
 * changelog/docs for R2 `SKILL.md` skill sources.
 */
export function parseGardenSkillDocument(raw: string) {
  const match = raw.match(SKILL_DOCUMENT_PATTERN)
  if (!match) {
    return Result.err(
      new SkillDocumentError({
        phase: 'validate',
        message: 'Skill document must start with YAML frontmatter',
      }),
    )
  }

  const parsed = Result.try({
    try: () => normalizeFrontmatter(parse(match[1] ?? '')),
    catch: (cause) =>
      new SkillDocumentError({
        phase: 'parse',
        message:
          cause instanceof Error
            ? cause.message
            : 'Skill frontmatter is invalid YAML',
      }),
  })
  if (parsed.isErr()) return parsed

  const name = requiredString(parsed.value.name)
  const description = requiredString(parsed.value.description)
  if (!name || !description) {
    return Result.err(
      new SkillDocumentError({
        phase: 'validate',
        message: 'Skill frontmatter must include name and description',
      }),
    )
  }

  return Result.ok({
    frontmatter: parsed.value,
    body: match[2] ?? '',
    name,
    description,
  } satisfies ParsedSkillDocument)
}

export function buildGardenSkillDocument(input: {
  name: string
  description: string
  body?: string
  frontmatter?: Record<string, unknown> | null
}) {
  const frontmatter = {
    ...input.frontmatter,
    name: input.name.trim(),
    description: input.description.trim(),
  }

  return `---\n${stringify(frontmatter).trim()}\n---\n\n${input.body ?? ''}`
}

export function updateGardenSkillDocument(input: {
  raw: string
  name?: string
  description?: string | null
  frontmatter?: Record<string, unknown>
}) {
  const parsed = parseGardenSkillDocument(input.raw)
  if (parsed.isErr()) return parsed

  return Result.ok(
    buildGardenSkillDocument({
      body: parsed.value.body,
      frontmatter: {
        ...parsed.value.frontmatter,
        ...input.frontmatter,
      },
      name: input.name ?? parsed.value.name,
      description: input.description ?? parsed.value.description,
    }),
  )
}
