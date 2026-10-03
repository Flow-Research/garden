import { queryOptions, useQuery } from '@tanstack/react-query'
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
  issues: (wsId: string, teamId: string) =>
    ['issues', wsId, 'team', teamId] as const,
}

/** Prefix used by issue mutations to invalidate every Team issue query. */
export function teamIssueCachesPrefix(wsId: string) {
  return ['issues', wsId, 'team'] as const
}

export function teamListOptions(wsId: string) {
  return queryOptions({
    queryKey: teamKeys.list(wsId),
    queryFn: () => api.listTeams(),
    staleTime: 30_000,
    placeholderData: (previous) => previous,
    select: (data) => data.teams,
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
 * Resolves a Team summary from the visible Team list so issue surfaces can
 * render a Team breadcrumb without a dedicated endpoint. Returns null for
 * workspace issues or when the list has not loaded.
 */
export function useTeamSummary(wsId: string, teamId: string | null) {
  const query = useQuery({
    ...teamListOptions(wsId),
    enabled: Boolean(wsId && teamId),
  })
  if (!teamId) return null
  return query.data?.find((team) => team.id === teamId) ?? null
}
