import { authClient } from '@/lib/auth/client'
import { ApiError } from './errors'
import type {
  Agent,
  CreateAgentRequest,
  CreateMemberRequest,
  Invitation,
  MemberWithUser,
  UpdateMemberRequest,
  Workspace,
} from '@garden/core/types'
import type { AgentPermissions } from '@garden/core/agents/permissions'
import type { PermissionTrustLevel } from '@garden/connectors/capabilities'
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

export function deleteMember(
  workspaceId: string,
  memberId: string,
): Promise<void> {
  return getApiTransport().request(
    `/api/workspaces/${workspaceId}/members/${memberId}`,
    { method: 'DELETE' },
  )
}

export async function leaveWorkspace(args: {
  workspaceId: string
}): Promise<void> {
  const result = await authClient.organization.leave({
    organizationId: args.workspaceId,
  })
  if (result.error) {
    throw new ApiError({
      message: result.error.message || 'Failed to leave workspace',
      status: result.error.status ?? 400,
      statusText: result.error.statusText ?? 'Bad Request',
    })
  }
}

export function listWorkspaceInvitations(
  workspaceId: string,
): Promise<Invitation[]> {
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

export function updateAgentPermissions(
  id: string,
  permissions: AgentPermissions,
): Promise<Agent> {
  return getApiTransport().request(`/api/agents/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ permissions }),
  })
}

export interface AgentConnectionTrust {
  connector_id: string
  trust: PermissionTrustLevel
  granted: boolean
  visible: boolean
}

export interface AgentToolTrust {
  connector_id: string
  tool_name: string
  risk_class: string
  trust: PermissionTrustLevel
  granted: boolean
  visible: boolean
}

export function getAgentAccess(id: string): Promise<{
  connections: AgentConnectionTrust[]
  tools: AgentToolTrust[]
}> {
  return getApiTransport().request(`/api/agents/${id}/access`)
}

export type AgentActivityEvent =
  | {
      id: string
      kind: 'tool_decision'
      tool_call_id: string
      connector_id: string
      tool_name: string
      result_status: string
      error: string | null
      timestamp: string | null
    }
  | {
      id: string
      kind: 'grant_change'
      event_type: string
      scope: string | null
      connector_id: string | null
      tool_name: string | null
      trust: string | null
      timestamp: string | null
    }

export function getAgentActivity(id: string): Promise<{
  events: AgentActivityEvent[]
}> {
  return getApiTransport().request(`/api/agents/${id}/activity`)
}

export function setAgentConnectionTrust(
  agentId: string,
  connectorId: string,
  trustLevel: PermissionTrustLevel,
): Promise<{ ok: true }> {
  return getApiTransport().request(
    `/api/connections/${encodeURIComponent(connectorId)}/grant`,
    {
      method: 'PATCH',
      body: JSON.stringify({ agentId, trustLevel }),
    },
  )
}

export function setAgentToolTrust(
  agentId: string,
  connectorId: string,
  toolName: string,
  trustLevel: PermissionTrustLevel,
): Promise<{ ok: true }> {
  return getApiTransport().request(
    `/api/connections/${encodeURIComponent(connectorId)}/tools/${encodeURIComponent(toolName)}/grant`,
    {
      method: 'PATCH',
      body: JSON.stringify({ agentId, trustLevel }),
    },
  )
}

export function deleteAgentToolTrust(
  agentId: string,
  connectorId: string,
  toolName: string,
): Promise<{ ok: true }> {
  return getApiTransport().request(
    `/api/connections/${encodeURIComponent(connectorId)}/tools/${encodeURIComponent(toolName)}/grant`,
    {
      method: 'DELETE',
      body: JSON.stringify({ agentId }),
    },
  )
}

export function deleteAgentConnectionTrust(
  agentId: string,
  connectorId: string,
): Promise<{ ok: true }> {
  return getApiTransport().request(
    `/api/connections/${encodeURIComponent(connectorId)}/grant`,
    {
      method: 'DELETE',
      body: JSON.stringify({ agentId }),
    },
  )
}

export function createAgent(data: CreateAgentRequest): Promise<Agent> {
  return getApiTransport().request('/api/agents', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}
