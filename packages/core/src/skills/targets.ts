import { Schema } from 'effect'

export const SkillTargetKind = Schema.Literals(['workspace_chat', 'agent'])
export type SkillTargetKind = typeof SkillTargetKind.Type

export const SkillTarget = Schema.Struct({
  kind: SkillTargetKind,
  id: Schema.String,
})
export type SkillTarget = typeof SkillTarget.Type

export function workspaceChatSkillTarget(workspaceId: string): SkillTarget {
  return { kind: 'workspace_chat', id: workspaceId }
}

export function agentSkillTarget(agentId: string): SkillTarget {
  return { kind: 'agent', id: agentId }
}
