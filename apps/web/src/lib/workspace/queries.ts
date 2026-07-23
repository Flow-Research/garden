import { queryOptions } from '@tanstack/react-query'
import { api, listConnections } from '@/lib/api'

export const workspaceKeys = {
  all: (wsId: string) => ['workspaces', wsId] as const,
  list: () => ['workspaces', 'list'] as const,
  members: (wsId: string) => ['workspaces', wsId, 'members'] as const,
  invitations: (wsId: string) => ['workspaces', wsId, 'invitations'] as const,
  agents: (wsId: string) => ['workspaces', wsId, 'agents'] as const,
  agent: (agentId: string) => ['agent', agentId] as const,
  agentSkills: (agentId: string) => ['agent', agentId, 'skills'] as const,
  skills: (wsId: string) => ['workspaces', wsId, 'skills'] as const,
  connections: (wsId: string) => ['workspaces', wsId, 'connections'] as const,
  assigneeFrequency: (wsId: string) =>
    ['workspaces', wsId, 'assignee-frequency'] as const,
}

export function workspaceListOptions() {
  return queryOptions({
    queryKey: workspaceKeys.list(),
    queryFn: () => api.listWorkspaces(),
  })
}

export function memberListOptions(wsId: string) {
  return queryOptions({
    queryKey: workspaceKeys.members(wsId),
    queryFn: () => api.listMembers(wsId),
    staleTime: 5 * 60_000,
  })
}

export function agentListOptions(wsId: string) {
  return queryOptions({
    queryKey: workspaceKeys.agents(wsId),
    queryFn: () =>
      api.listAgents({ workspace_id: wsId, include_archived: true }),
  })
}

export function agentDetailOptions(agentId: string) {
  return queryOptions({
    queryKey: workspaceKeys.agent(agentId),
    queryFn: () => api.getAgent(agentId),
    enabled: Boolean(agentId),
  })
}

export function agentSkillListOptions(agentId: string) {
  return queryOptions({
    queryKey: workspaceKeys.agentSkills(agentId),
    queryFn: () => api.listAgentSkills(agentId),
    enabled: Boolean(agentId),
  })
}

export function skillListOptions(wsId: string) {
  return queryOptions({
    queryKey: workspaceKeys.skills(wsId),
    queryFn: () => api.listSkills({ workspace_id: wsId }),
  })
}

/** Reuses the workspace-warmed connection snapshot across panels. Connection
 * mutations and OAuth completion invalidate this key explicitly, so consumers
 * can render cached data immediately and refresh stale data in the background. */
export function connectionListOptions(wsId: string) {
  return queryOptions({
    queryKey: workspaceKeys.connections(wsId),
    queryFn: () => listConnections(),
    staleTime: 5 * 60_000,
  })
}

export function invitationListOptions(wsId: string) {
  return queryOptions({
    queryKey: workspaceKeys.invitations(wsId),
    queryFn: () => api.listWorkspaceInvitations(wsId),
  })
}

export function assigneeFrequencyOptions(wsId: string) {
  return queryOptions({
    queryKey: workspaceKeys.assigneeFrequency(wsId),
    queryFn: () => api.getAssigneeFrequency({ workspace_id: wsId }),
  })
}
