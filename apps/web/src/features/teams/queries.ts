import { queryOptions } from '@tanstack/react-query'
import type { Issue } from '@garden/core/types'
import { api } from '@/lib/api'

/**
 * Query keys follow the spec: workspace-scoped Team keys plus Team issue keys
 * under the existing `issues` root so issue mutations can invalidate them by
 * prefix.
 */
export const teamKeys = {
  all: (wsId: string) => ['teams', wsId] as const,
  list: (wsId: string) => [...teamKeys.all(wsId), 'list'] as const,
  detail: (wsId: string, teamId: string) =>
    [...teamKeys.all(wsId), 'detail', teamId] as const,
  members: (wsId: string, teamId: string) =>
    [...teamKeys.all(wsId), 'members', teamId] as const,
  agentPolicy: (wsId: string, teamId: string) =>
    [...teamKeys.all(wsId), 'agent-policy', teamId] as const,
  repositories: (wsId: string, teamId: string) =>
    [...teamKeys.all(wsId), 'repositories', teamId] as const,
  availableRepositories: (wsId: string, teamId: string) =>
    [...teamKeys.all(wsId), 'repositories', teamId, 'available'] as const,
  issues: (wsId: string, teamId: string) =>
    ['issues', wsId, 'team', teamId] as const,
  inviteSettings: (wsId: string) =>
    [...teamKeys.all(wsId), 'invite-settings'] as const,
}

/** Prefix used by issue mutations to invalidate every Team issue query. */
export function teamIssueCachesPrefix(wsId: string) {
  return ['issues', wsId, 'team'] as const
}

/**
 * The Team list keeps the full response, `{ teams, total, unique_member_count }`.
 * It used to select only `teams`, so the overview had to override `select` to
 * read the workspace-wide member count from the same cache entry. Callers now
 * read `.teams` themselves and every reader sees one shape.
 */
export function teamListOptions(wsId: string) {
  return queryOptions({
    queryKey: teamKeys.list(wsId),
    queryFn: () => api.listTeams(),
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  })
}

export function teamDetailOptions(wsId: string, teamId: string) {
  return queryOptions({
    queryKey: teamKeys.detail(wsId, teamId),
    queryFn: () => api.getTeam(teamId),
    staleTime: 15_000,
    placeholderData: (previous) => previous,
  })
}

export function teamMemberListOptions(wsId: string, teamId: string) {
  return queryOptions({
    queryKey: teamKeys.members(wsId, teamId),
    queryFn: () => api.listTeamMembers(teamId),
    staleTime: 15_000,
    placeholderData: (previous) => previous,
    select: (data) => data.members,
  })
}

/**
 * A Team's agent policy. Under the `teams` root, so `team:policy_updated`
 * realtime events refetch it with every other Team query.
 */
export function teamAgentPolicyOptions(wsId: string, teamId: string) {
  return queryOptions({
    queryKey: teamKeys.agentPolicy(wsId, teamId),
    queryFn: () => api.getTeamAgentPolicy(teamId),
    staleTime: 30_000,
  })
}

/**
 * Repositories linked to a Team. The key sits under the Team root, so the
 * `team:updated` event an import publishes refreshes the import state.
 */
export function teamRepositoryListOptions(wsId: string, teamId: string) {
  return queryOptions({
    queryKey: teamKeys.repositories(wsId, teamId),
    queryFn: () => api.listTeamRepositories(teamId),
    staleTime: 15_000,
    placeholderData: (previous) => previous,
    select: (data) => data.repositories,
  })
}

/** Repositories the GitHub App can access, loaded when the picker opens. */
export function availableTeamRepositoryListOptions(
  wsId: string,
  teamId: string,
) {
  return queryOptions({
    queryKey: teamKeys.availableRepositories(wsId, teamId),
    queryFn: () => api.listAvailableTeamRepositories(teamId),
    staleTime: 60_000,
    select: (data) => data.repositories,
  })
}

export function teamIssueListOptions(wsId: string, teamId: string) {
  return queryOptions({
    queryKey: teamKeys.issues(wsId, teamId),
    queryFn: async () => {
      const response = await api.listIssues({
        team_id: teamId,
        workspace_id: wsId,
      })
      return response.issues
    },
    staleTime: 15_000,
    placeholderData: (previous: Issue[] | undefined) => previous,
  })
}

/**
 * Every Team issue visible to the caller, across Teams. Used by the admin
 * Teams › Issues / Teams › Tasks pages; the `'all'` key sits under the team
 * issue prefix so existing issue mutations invalidate it.
 *
 * Uses has_team=true so the server filters team_id IS NOT NULL — previously
 * this fetched every workspace issue and discarded non-team rows client-side.
 */
export function allTeamIssuesOptions(wsId: string) {
  return queryOptions({
    queryKey: [...teamKeys.issues(wsId, 'all')],
    queryFn: async () => {
      const response = await api.listIssues({
        workspace_id: wsId,
        has_team: true,
      })
      return response.issues
    },
    staleTime: 15_000,
    placeholderData: (previous: Issue[] | undefined) => previous,
  })
}

/** Workspace invite settings: Team owner invites and the default Team. */
export function workspaceTeamSettingsOptions(wsId: string) {
  return queryOptions({
    queryKey: teamKeys.inviteSettings(wsId),
    queryFn: () => api.getWorkspaceTeamSettings(wsId),
    staleTime: 60_000,
  })
}
