import { r2 as r2SkillSource, type SkillSource } from 'agents/skills'

const WORKSPACE_SKILL_R2_PREFIX = 'agent-skills/workspaces'
const AGENT_SKILL_R2_PREFIX = 'agent-skills/agents'
const BUILTIN_SKILL_R2_PREFIX = 'builtin-skills'

export function workspaceSkillR2Prefix(workspaceId: string) {
  return `${WORKSPACE_SKILL_R2_PREFIX}/${workspaceId}/`
}

export function workspaceSkillObjectKey(input: {
  workspaceId: string
  slug: string
  path: string
}) {
  return `${workspaceSkillR2Prefix(input.workspaceId)}${input.slug}/${input.path}`
}

export function agentSkillR2Prefix(agentId: string) {
  return `${AGENT_SKILL_R2_PREFIX}/${agentId}/`
}

/**
 * Uses SDK R2 Agent Skills sources directly. Garden projects attached workspace
 * skills into a per-agent R2 prefix, so Think can index only that agent's
 * standard skill directories without DB catalogs, custom providers, or runtime
 * file materialization.
 */
export function createGardenSkillSources(input: {
  bucket: R2Bucket
  agentId: string | null
}): SkillSource[] {
  const sources: SkillSource[] = []

  if (input.agentId) {
    sources.push(
      r2SkillSource(input.bucket, {
        id: `garden-agent:${input.agentId}`,
        prefix: agentSkillR2Prefix(input.agentId),
        refreshIntervalMs: 0,
      }),
    )
  }

  sources.push(
    r2SkillSource(input.bucket, {
      id: 'garden-builtins',
      prefix: `${BUILTIN_SKILL_R2_PREFIX}/`,
    }),
  )

  return sources
}
