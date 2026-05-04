import { queryOptions } from '@tanstack/react-query'
import { Result } from 'better-result'
import type { MemberWithUser, Agent } from '@garden/core/types'
import { api } from '@/lib/api'

// MOCK: members + agents referenced by mock issues / inbox. Falls in when the
// real workspace API returns nothing so actor names resolve in the UI.
const mockMembers: MemberWithUser[] = [
  {
    id: 'mock_mem_alice',
    workspace_id: '',
    user_id: 'mem_alice',
    role: 'owner',
    created_at: new Date().toISOString(),
    name: 'Alice',
    email: 'alice@acme.com',
    avatar_url: null,
  },
  {
    id: 'mock_mem_bob',
    workspace_id: '',
    user_id: 'mem_bob',
    role: 'member',
    created_at: new Date().toISOString(),
    name: 'Bob',
    email: 'bob@acme.com',
    avatar_url: null,
  },
]

const mockAgents: Agent[] = [
  {
    id: 'agent_garden',
    workspace_id: '',
    runtime_id: 'mock_runtime',
    name: 'Garden',
    description: 'Master agent — chat, delegation, can spawn other agents',
    instructions: '',
    avatar_url: null,
    runtime_mode: 'cloud',
    runtime_config: {},
    custom_env: {},
    custom_args: [],
    custom_env_redacted: false,
    visibility: 'workspace',
    status: 'idle',
    max_concurrent_tasks: 3,
    owner_id: null,
    skills: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    archived_at: null,
    archived_by: null,
  },
  {
    id: 'agent_researcher',
    workspace_id: '',
    runtime_id: 'mock_runtime',
    name: 'Researcher',
    description: 'Researcher',
    instructions: '',
    avatar_url: null,
    runtime_mode: 'cloud',
    runtime_config: {},
    custom_env: {},
    custom_args: [],
    custom_env_redacted: false,
    visibility: 'workspace',
    status: 'idle',
    max_concurrent_tasks: 2,
    owner_id: null,
    skills: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    archived_at: null,
    archived_by: null,
  },
]

export const workspaceKeys = {
  all: (wsId: string) => ['workspaces', wsId] as const,
  list: () => ['workspaces', 'list'] as const,
  members: (wsId: string) => ['workspaces', wsId, 'members'] as const,
  invitations: (wsId: string) => ['workspaces', wsId, 'invitations'] as const,
  myInvitations: () => ['invitations', 'mine'] as const,
  agents: (wsId: string) => ['workspaces', wsId, 'agents'] as const,
  agent: (agentId: string) => ['agent', agentId] as const,
  agentSkills: (agentId: string) => ['agent', agentId, 'skills'] as const,
  skills: (wsId: string) => ['workspaces', wsId, 'skills'] as const,
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
    queryFn: async () => {
      const realCall = await Result.tryPromise({
        try: async () => api.listMembers(wsId),
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      })
      const real = realCall.isOk() ? realCall.value : []
      // Always include mock members so mock issues resolve to friendly names.
      // Real members take priority on id collisions.
      const realIds = new Set(real.map((m) => m.user_id))
      const supplemented = [
        ...real,
        ...mockMembers
          .filter((m) => !realIds.has(m.user_id))
          .map((m) => ({ ...m, workspace_id: wsId })),
      ]
      return supplemented
    },
  })
}

export function agentListOptions(wsId: string) {
  return queryOptions({
    queryKey: workspaceKeys.agents(wsId),
    queryFn: async () => {
      const realCall = await Result.tryPromise({
        try: async () =>
          api.listAgents({ workspace_id: wsId, include_archived: true }),
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      })
      const real = realCall.isOk() ? realCall.value : []
      const realIds = new Set(real.map((a) => a.id))
      const supplemented: Agent[] = [
        ...real,
        ...mockAgents
          .filter((a) => !realIds.has(a.id))
          .map((a) => ({ ...a, workspace_id: wsId })),
      ]
      return supplemented
    },
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
    queryFn: () => api.listSkills(),
  })
}

export function invitationListOptions(wsId: string) {
  return queryOptions({
    queryKey: workspaceKeys.invitations(wsId),
    queryFn: () => api.listWorkspaceInvitations(wsId),
  })
}

export function myInvitationListOptions() {
  return queryOptions({
    queryKey: workspaceKeys.myInvitations(),
    queryFn: () => api.listMyInvitations(),
  })
}

export function assigneeFrequencyOptions(wsId: string) {
  return queryOptions({
    queryKey: workspaceKeys.assigneeFrequency(wsId),
    queryFn: () => api.getAssigneeFrequency(),
  })
}
