import { and, eq } from 'drizzle-orm'
import issueInteractionSkillMarkdown from '@garden/agent-runtime/src/skills/issue-interaction/SKILL.md?raw'
import { bindSkillToWorkspaceAgents } from './agent-bindings'
import { type getDb, schema } from './db'
import { hashSkillBundle } from './skill-bundles'

type Db = ReturnType<typeof getDb>

function parseFrontmatter(markdown: string) {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(markdown)
  if (!match) {
    return { frontmatter: null, body: markdown }
  }

  return {
    frontmatter: match[1],
    body: match[2],
  }
}

export async function seedBuiltinSkills(workspaceId: string, db: Db) {
  const slug = 'issue-interaction'
  const existing = await db
    .select({ id: schema.skill.id })
    .from(schema.skill)
    .where(
      and(
        eq(schema.skill.workspaceId, workspaceId),
        eq(schema.skill.slug, slug),
      ),
    )
    .limit(1)

  if (existing.some((skill) => skill.id)) return

  const parsed = parseFrontmatter(issueInteractionSkillMarkdown)
  const bundleHash = await hashSkillBundle({
    content: issueInteractionSkillMarkdown,
    files: [],
  })
  const skillId = crypto.randomUUID()

  // Source: docs/research/issue-flow-plan.md, "Issue page is the primary surface".
  await db.insert(schema.skill).values({
    id: skillId,
    workspaceId,
    name: 'Issue interaction',
    slug,
    description:
      'How to behave when assigned to an issue: read, plan, decide, act.',
    frontmatter: parsed.frontmatter,
    body: parsed.body,
    sourceType: 'builtin',
    sourceUrl: null,
    bundleHash,
    authorId: null,
  })

  await bindSkillToWorkspaceAgents({
    db,
    schema,
    skillId,
    workspaceId,
  })
}
