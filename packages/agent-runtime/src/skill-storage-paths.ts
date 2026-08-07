const WORKSPACE_SKILL_R2_PREFIX = 'agent-skills/workspaces'

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
