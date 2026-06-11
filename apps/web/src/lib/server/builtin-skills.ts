import { and, eq } from 'drizzle-orm'
import { HARNESSY_QA_SKILLS } from '@garden/agent-runtime'
import issueInteractionSkillMarkdown from '@garden/agent-runtime/src/skills/issue-interaction/SKILL.md?raw'
import { schema, type Db } from './db'
import {
  hashSkillBundle,
  persistRuntimeSkillBundle,
  persistSkillBundleFiles,
} from './skill-bundles'
import { parseGardenSkillDocument } from './skill-documents'

type BuiltinSeedSkill = {
  slug: string
  name: string
  description: string
  content: string
  files: Array<{ path: string; content: string }>
  sourceUrl?: string | null
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
  ...HARNESSY_QA_SKILLS.map((skill) => ({
    ...skill,
    sourceUrl: 'https://github.com/Flow-Research/harnessy',
  })),
]

/**
 * Seeds built-in skills into the workspace skill library and standard Agent
 * Skills R2 layout.
 *
 * Earlier bootstraps only installed the issue-interaction skill, which meant
 * Garden automations had no durable QA operating pack to load. The Harnessy QA
 * skills are now vendored into the runtime bundle and seeded here so workspaces
 * receive the deterministic QA contract, browser workflow, codegen helpers, and
 * validators without depending on a live skills.sh import. Source reference:
 * Flow-Research/harnessy `.jarvis/context/docs/standards/qa-process.md` and
 * `tools/flow-install/skills/*`.
 */
export async function seedBuiltinSkills(
  workspaceId: string,
  db: Db,
  bucket: R2Bucket,
) {
  for (const seed of BUILTIN_SEED_SKILLS) {
    const existing = await db
      .select({ id: schema.skill.id })
      .from(schema.skill)
      .where(
        and(
          eq(schema.skill.workspaceId, workspaceId),
          eq(schema.skill.slug, seed.slug),
        ),
      )
      .limit(1)

    if (existing.some((skill) => skill.id)) {
      const runtimeBundleResult = await persistRuntimeSkillBundle({
        bucket,
        workspaceId,
        slug: seed.slug,
        content: seed.content,
        files: seed.files,
      })
      if (runtimeBundleResult.isErr()) {
        throw runtimeBundleResult.error
      }
      continue
    }

    const parsed = parseGardenSkillDocument(seed.content)
    if (parsed.isErr()) throw parsed.error

    const bundleHash = await hashSkillBundle({
      content: seed.content,
      files: seed.files,
    })
    const skillId = crypto.randomUUID()

    await db.insert(schema.skill).values({
      id: skillId,
      workspaceId,
      name: parsed.value.name,
      slug: seed.slug,
      description: parsed.value.description,
      frontmatter: JSON.stringify(parsed.value.frontmatter),
      body: seed.content,
      sourceType: 'builtin',
      sourceUrl: seed.sourceUrl ?? null,
      bundleHash,
      authorId: null,
    })

    if (seed.files.length > 0) {
      const storedFiles = await persistSkillBundleFiles({
        bucket,
        workspaceId,
        skillId,
        bundleHash,
        files: seed.files,
      })
      if (storedFiles.length > 0) {
        await db.insert(schema.skillFile).values(storedFiles)
      }
    }

    const runtimeBundleResult = await persistRuntimeSkillBundle({
      bucket,
      workspaceId,
      slug: seed.slug,
      content: seed.content,
      files: seed.files,
    })
    if (runtimeBundleResult.isErr()) {
      throw runtimeBundleResult.error
    }
  }
}
