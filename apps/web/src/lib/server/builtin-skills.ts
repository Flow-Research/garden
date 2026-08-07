import { and, eq } from 'drizzle-orm'
import { Effect, Schema } from 'effect'
import { parseSkillMarkdown } from 'agents/skills'
import issueInteractionSkillMarkdown from '@garden/agent-runtime/src/skills/issue-interaction/SKILL.md?raw'
import { SkillMetadata, workspaceChatSkillTarget } from '@garden/core/skills'
import { schema, type Db } from './db'

type BuiltinSeedSkill = {
  readonly slug: string
  readonly name: string
  readonly description: string
  readonly content: string
  readonly files: ReadonlyArray<{
    readonly path: string
    readonly content: string
  }>
  readonly sourceUrl?: string | null
}

const BUILTIN_SEED_SKILLS: readonly BuiltinSeedSkill[] = [
  {
    slug: 'issue-interaction',
    name: 'Issue interaction',
    description:
      'How to behave when assigned to an issue: read, plan, decide, act.',
    content: issueInteractionSkillMarkdown,
    files: [],
  },
]

const runtimePrefix = (workspaceId: string, slug: string) =>
  `agent-skills/workspaces/${workspaceId}/${slug}/`

const fileContentType = (path: string) => {
  if (path.toLowerCase().endsWith('.md')) {
    return 'text/markdown; charset=utf-8'
  }
  return 'text/plain; charset=utf-8'
}

const digest = (value: string) =>
  Effect.promise(async () => {
    const buffer = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(value),
    )
    return Array.from(new Uint8Array(buffer), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('')
  })

/**
 * Seeds built-in skill rows, workspace-chat assignments, and canonical R2 bundles.
 * The Effect program owns sequencing; the Promise exists only for the existing
 * workspace-bootstrap caller.
 */
export function seedBuiltinSkills(
  workspaceId: string,
  db: Db,
  bucket: R2Bucket,
) {
  const dbOperation = <A>(run: () => Promise<A>) => Effect.promise(run)

  const replaceRuntimeBundle = Effect.fn('BuiltinSkills.replaceRuntimeBundle')(
    function* (seed: BuiltinSeedSkill) {
      const prefix = runtimePrefix(workspaceId, seed.slug)
      let cursor: string | undefined
      do {
        const listed = yield* Effect.promise(() =>
          bucket.list({ prefix, cursor }),
        )
        const keys = listed.objects.map((object) => object.key)
        if (keys.length > 0) {
          yield* Effect.promise(() => bucket.delete(keys))
        }
        cursor = listed.truncated ? listed.cursor : undefined
      } while (cursor)

      yield* Effect.forEach(
        [{ path: 'SKILL.md', content: seed.content }, ...seed.files],
        (file) =>
          Effect.promise(() =>
            bucket.put(`${prefix}${file.path}`, file.content, {
              httpMetadata: { contentType: fileContentType(file.path) },
            }),
          ),
        { concurrency: 4, discard: true },
      )
    },
  )

  const program = Effect.forEach(
    BUILTIN_SEED_SKILLS,
    (seed) =>
      Effect.gen(function* () {
        const existing = yield* dbOperation(() =>
          db
            .select({ id: schema.skill.id })
            .from(schema.skill)
            .where(
              and(
                eq(schema.skill.workspaceId, workspaceId),
                eq(schema.skill.slug, seed.slug),
              ),
            )
            .limit(1),
        )
        const skillId = existing[0]?.id ?? crypto.randomUUID()
        const target = workspaceChatSkillTarget(workspaceId)

        if (!existing[0]) {
          const parsed = parseSkillMarkdown(seed.content)
          if (!parsed) {
            return yield* Effect.fail(
              new Error(`Invalid built-in skill document: ${seed.slug}`),
            )
          }
          const metadata = yield* Schema.decodeUnknownEffect(SkillMetadata)({
            name: parsed.name,
            description: parsed.description,
            compatibility: parsed.compatibility,
            license: parsed.license,
            'allowed-tools': parsed.allowedTools,
            metadata: parsed.metadata,
          })
          const bundleHash = yield* digest(
            [
              seed.content,
              ...[...seed.files]
                .sort((left, right) => left.path.localeCompare(right.path))
                .map((file) => `${file.path}\n${file.content}`),
            ].join('\n---\n'),
          )
          const storedFiles = yield* Effect.forEach(
            seed.files,
            (file) =>
              Effect.gen(function* () {
                const contentHash = yield* digest(file.content)
                const r2Key = [
                  'skills',
                  workspaceId,
                  skillId,
                  bundleHash,
                  file.path,
                ].join('/')
                yield* Effect.promise(() =>
                  bucket.put(r2Key, file.content, {
                    httpMetadata: { contentType: fileContentType(file.path) },
                  }),
                )
                return {
                  id: crypto.randomUUID(),
                  skillId,
                  path: file.path,
                  contentHash,
                  r2Key,
                }
              }),
            { concurrency: 4 },
          )

          yield* dbOperation(() =>
            db.transaction(async (tx) => {
              await tx.insert(schema.skill).values({
                id: skillId,
                workspaceId,
                name: parsed.name,
                slug: seed.slug,
                description: parsed.description,
                frontmatter: JSON.stringify(metadata),
                body: seed.content,
                sourceType: 'builtin',
                sourceUrl: seed.sourceUrl ?? null,
                bundleHash,
                authorId: null,
              })
              if (storedFiles.length > 0) {
                await tx.insert(schema.skillFile).values(storedFiles)
              }
            }),
          )
        }

        yield* dbOperation(() =>
          db
            .insert(schema.skillAssignment)
            .values({
              workspaceId,
              targetKind: target.kind,
              targetId: target.id,
              skillId,
              enabled: true,
            })
            .onConflictDoUpdate({
              target: [
                schema.skillAssignment.workspaceId,
                schema.skillAssignment.targetKind,
                schema.skillAssignment.targetId,
                schema.skillAssignment.skillId,
              ],
              set: { enabled: true, updatedAt: new Date() },
            }),
        )
        yield* replaceRuntimeBundle(seed)
      }),
    { discard: true },
  )

  return Effect.runPromise(program)
}
