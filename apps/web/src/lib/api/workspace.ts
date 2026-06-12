import type {
  Agent,
  AgentSkill,
  CreateAgentRequest,
  CreateMemberRequest,
  Invitation,
  MemberWithUser,
  SetAgentSkillsRequest,
  Skill,
  UpdateMemberRequest,
  Workspace,
} from '@garden/core/types'
import { getApiTransport } from './state'

export function listWorkspaces(): Promise<Workspace[]> {
  return getApiTransport().request('/api/workspaces')
}

export function createWorkspace(data: {
  name: string
  slug: string
  description?: string
  context?: string
}): Promise<Workspace> {
  return getApiTransport().request('/api/workspaces', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function updateWorkspace(
  id: string,
  data: {
    name?: string
    description?: string
    context?: string
    settings?: Record<string, unknown>
  },
): Promise<Workspace> {
  return getApiTransport().request(`/api/workspaces/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export function deleteWorkspace(workspaceId: string): Promise<void> {
  return getApiTransport().request(`/api/workspaces/${workspaceId}`, {
    method: 'DELETE',
  })
}

export function listMembers(workspaceId: string): Promise<MemberWithUser[]> {
  return getApiTransport().request(`/api/workspaces/${workspaceId}/members`)
}

export function createMember(
  workspaceId: string,
  data: CreateMemberRequest,
): Promise<Invitation> {
  return getApiTransport().request(`/api/workspaces/${workspaceId}/members`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function updateMember(
  workspaceId: string,
  memberId: string,
  data: UpdateMemberRequest,
): Promise<MemberWithUser> {
  return getApiTransport().request(
    `/api/workspaces/${workspaceId}/members/${memberId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(data),
    },
  )
}

export function deleteMember(workspaceId: string, memberId: string): Promise<void> {
  return getApiTransport().request(
    `/api/workspaces/${workspaceId}/members/${memberId}`,
    { method: 'DELETE' },
  )
}

export function leaveWorkspace(args: {
  memberId: string
  workspaceId: string
}): Promise<void> {
  return deleteMember(args.workspaceId, args.memberId)
}

export function listWorkspaceInvitations(workspaceId: string): Promise<Invitation[]> {
  return getApiTransport().request(`/api/workspaces/${workspaceId}/invitations`)
}

export function revokeInvitation(
  workspaceId: string,
  invitationId: string,
): Promise<void> {
  return getApiTransport().request(
    `/api/workspaces/${workspaceId}/invitations/${invitationId}`,
    { method: 'DELETE' },
  )
}

export function listMyInvitations(): Promise<Invitation[]> {
  return getApiTransport().request('/api/invitations')
}

export function getInvitation(invitationId: string): Promise<Invitation> {
  return getApiTransport().request(`/api/invitations/${invitationId}`)
}

export function acceptInvitation(invitationId: string): Promise<MemberWithUser> {
  return getApiTransport().request(`/api/invitations/${invitationId}/accept`, {
    method: 'POST',
  })
}

export function listAgents(params?: {
  workspace_id?: string
  include_archived?: boolean
}): Promise<Agent[]> {
  const search = new URLSearchParams()
  if (params?.workspace_id) search.set('workspace_id', params.workspace_id)
  if (params?.include_archived) search.set('include_archived', 'true')
  return getApiTransport().request(`/api/agents?${search}`)
}

export function getAgent(id: string): Promise<Agent> {
  return getApiTransport().request(`/api/agents/${id}`)
}

export function createAgent(data: CreateAgentRequest): Promise<Agent> {
  return getApiTransport().request('/api/agents', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function listAgentSkills(agentId: string): Promise<AgentSkill[]> {
  return getApiTransport().request(`/api/agents/${agentId}/skills`)
}

export function setAgentSkills(
  agentId: string,
  data: SetAgentSkillsRequest,
): Promise<void> {
  return getApiTransport().request(`/api/agents/${agentId}/skills`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

export function listSkills(): Promise<Skill[]> {
  return getApiTransport().request('/api/skills')
}
