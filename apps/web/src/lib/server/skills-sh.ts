import { Context, Effect, Layer, Schema } from 'effect'
import { HttpClient, HttpClientRequest } from 'effect/unstable/http'
import {
  SkillMetadata,
  SkillOperationError,
  SkillValidationError,
  type ImportSkillRequest,
  type SkillFileInput,
  type SkillsShSearchResult,
} from '@garden/core/skills'
import { SkillDocuments } from './skill-documents'

const SKILLS_SH_ORIGIN = 'https://skills.sh'
const SKILLS_SH_SEARCH_PATH = '/api/search'
const SKILLS_SH_DOWNLOAD_PATH = '/api/download'

export type SkillsShSkillRef = {
  readonly owner: string
  readonly repo: string
  readonly skill: string
  readonly source: string
  readonly canonicalUrl: string
}

export type ImportedSkillBundleDraft = {
  readonly sourceType: 'skills.sh'
  readonly sourceUrl: string
  readonly bundleHash: string
  readonly slug: string
  readonly name: string
  readonly description: string
  readonly content: string
  readonly config: SkillMetadata
  readonly files: SkillFileInput[]
}

export interface SkillsShService {
  readonly search: (
    query: string,
    limit: number,
  ) => Effect.Effect<SkillsShSearchResult[], SkillOperationError>
  readonly download: (
    input: ImportSkillRequest,
  ) => Effect.Effect<
    ImportedSkillBundleDraft,
    SkillValidationError | SkillOperationError
  >
}

export class SkillsSh extends Context.Service<SkillsSh, SkillsShService>()(
  '@garden/web/SkillsSh',
) {}

const ExternalSearchSkill = Schema.Struct({
  id: Schema.String,
  skillId: Schema.String,
  name: Schema.String,
  installs: Schema.optional(Schema.Number),
  source: Schema.String,
})
const ExternalSearchResponse = Schema.Struct({
  skills: Schema.optional(Schema.Array(ExternalSearchSkill)),
})
const ExternalDownloadFile = Schema.Struct({
  path: Schema.String,
  contents: Schema.String,
})
const ExternalDownloadResponse = Schema.Struct({
  files: Schema.Array(ExternalDownloadFile),
  hash: Schema.String,
})

function parseSkillRef(input: string): SkillsShSkillRef | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const parsedUrl = URL.parse(trimmed)
  let segments: string[]
  if (parsedUrl) {
    segments =
      parsedUrl.hostname === 'skills.sh'
        ? parsedUrl.pathname.split('/').filter(Boolean)
        : []
  } else {
    segments = trimmed.split('/').filter(Boolean)
  }

  if (segments.length !== 3) return null
  const [owner, repo, skill] = segments.map((segment) => segment.trim())
  if (!owner || !repo || !skill) return null
  return {
    owner,
    repo,
    skill,
    source: `${owner}/${repo}`,
    canonicalUrl: `${SKILLS_SH_ORIGIN}/${owner}/${repo}/${skill}`,
  }
}

function normalizedImportUrl(input: ImportSkillRequest) {
  return (
    input.url ??
    (input.source && input.skill ? `${input.source}/${input.skill}` : '')
  )
}

function normalizeBundlePath(path: string) {
  const normalized = path.replace(/\\/g, '/').trim()
  if (!normalized || normalized.startsWith('/')) return null
  const segments = normalized.split('/').filter(Boolean)
  if (segments.length === 0 || segments.some((segment) => segment === '..')) {
    return null
  }
  return segments.join('/')
}

export const skillsShLayer = Layer.effect(
  SkillsSh,
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    const documents = yield* SkillDocuments

    const requestJson = Effect.fn('SkillsSh.requestJson')(function* <A>(
      operation: string,
      url: string,
      schema: Schema.Decoder<A>,
    ) {
      const response = yield* client
        .execute(
          HttpClientRequest.get(url).pipe(
            HttpClientRequest.setHeader('accept', 'application/json'),
          ),
        )
        .pipe(
          Effect.mapError(
            (cause) =>
              new SkillOperationError({
                operation,
                message: `skills.sh ${operation} request failed.`,
                cause,
              }),
          ),
        )
      if (response.status < 200 || response.status >= 300) {
        return yield* new SkillOperationError({
          operation,
          message: `skills.sh ${operation} request returned ${response.status}.`,
        })
      }
      const text = yield* response.text.pipe(
        Effect.mapError(
          (cause) =>
            new SkillOperationError({
              operation,
              message: `skills.sh ${operation} response could not be read.`,
              cause,
            }),
        ),
      )
      return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(
        text,
      ).pipe(
        Effect.mapError(
          (cause) =>
            new SkillOperationError({
              operation,
              message: `skills.sh returned an invalid ${operation} response.`,
              cause,
            }),
        ),
      )
    })

    const search = Effect.fn('SkillsSh.search')(function* (
      query: string,
      limit: number,
    ) {
      const trimmed = query.trim()
      if (!trimmed) return []
      const url = new URL(SKILLS_SH_SEARCH_PATH, SKILLS_SH_ORIGIN)
      url.searchParams.set('q', trimmed)
      url.searchParams.set('limit', String(Math.max(1, Math.min(limit, 25))))
      const payload = yield* requestJson(
        'search',
        url.toString(),
        ExternalSearchResponse,
      )
      return (payload.skills ?? []).map((skill) => ({
        id: skill.id,
        skill_id: skill.skillId,
        name: skill.name,
        installs: skill.installs ?? 0,
        source: skill.source,
      }))
    })

    const download = Effect.fn('SkillsSh.download')(function* (
      input: ImportSkillRequest,
    ) {
      const ref = parseSkillRef(normalizedImportUrl(input))
      if (!ref) {
        return yield* new SkillValidationError({
          operation: 'import skill',
          message:
            'Invalid skills.sh skill reference. Use skills.sh/owner/repo/skill',
        })
      }

      const url = new URL(
        `${SKILLS_SH_DOWNLOAD_PATH}/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/${encodeURIComponent(ref.skill)}`,
        SKILLS_SH_ORIGIN,
      )
      const payload = yield* requestJson(
        'download',
        url.toString(),
        ExternalDownloadResponse,
      )
      const bundleHash = payload.hash.trim()
      if (!bundleHash) {
        return yield* new SkillValidationError({
          operation: 'import skill',
          message: 'skills.sh bundle hash is missing',
        })
      }

      const normalized = payload.files.flatMap((file) => {
        const path = normalizeBundlePath(file.path)
        return path ? [{ path, content: file.contents }] : []
      })
      const document = normalized.find(
        (file) => file.path.toLowerCase() === 'skill.md',
      )
      if (!document) {
        return yield* new SkillValidationError({
          operation: 'import skill',
          message: 'skills.sh bundle is missing SKILL.md',
        })
      }
      const parsed = yield* documents.parse(document.content)
      const config = yield* Schema.decodeUnknownEffect(SkillMetadata)({
        ...parsed.frontmatter,
        import: {
          provider: 'skills.sh',
          owner: ref.owner,
          repo: ref.repo,
          skill: ref.skill,
          source: ref.source,
        },
      }).pipe(
        Effect.mapError(
          () =>
            new SkillValidationError({
              operation: 'import skill',
              message: 'skills.sh skill metadata is invalid',
            }),
        ),
      )

      return {
        sourceType: 'skills.sh' as const,
        sourceUrl: ref.canonicalUrl,
        bundleHash,
        slug: ref.skill,
        name: parsed.name,
        description: parsed.description,
        content: document.content,
        config,
        files: normalized.filter(
          (file) => file.path.toLowerCase() !== 'skill.md',
        ),
      }
    })

    return SkillsSh.of({ search, download })
  }),
)
