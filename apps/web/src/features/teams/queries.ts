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
  issues: (wsId: string, teamId: string) =>
    ['issues', wsId, 'team', teamId] as const,
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
