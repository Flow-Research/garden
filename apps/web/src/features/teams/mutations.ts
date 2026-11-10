import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useWorkspaceId } from '@garden/app-state/hooks'
import type {
  AddTeamMemberRequest,
  LinkTeamRepositoryRequest,
  CreateTeamRequest,
  TransferTeamOwnerRequest,
  UpdateTeamRequest,
  WorkspaceTeamSettings,
} from '@garden/core/types'
import { api } from '@/lib/api'
import { teamKeys } from './queries'

export function useCreateTeam() {
  const qc = useQueryClient()
  const wsId = useWorkspaceId()
  return useMutation({
    mutationFn: (data: CreateTeamRequest) => api.createTeam(data),
    onSuccess: (team) => {
      qc.setQueryData(teamKeys.detail(wsId, team.id), team)
      qc.invalidateQueries({ queryKey: teamKeys.list(wsId) })
    },
  })
}

export function useUpdateTeam() {
  const qc = useQueryClient()
  const wsId = useWorkspaceId()
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & UpdateTeamRequest) =>
      api.updateTeam(id, data),
    onSuccess: (team) => {
      qc.setQueryData(teamKeys.detail(wsId, team.id), team)
      qc.invalidateQueries({ queryKey: teamKeys.list(wsId) })
    },
  })
}

export function useDeleteTeam() {
  const qc = useQueryClient()
  const wsId = useWorkspaceId()
  return useMutation({
    mutationFn: (id: string) => api.deleteTeam(id),
    onSuccess: (_data, id) => {
      qc.removeQueries({ queryKey: teamKeys.detail(wsId, id) })
      qc.invalidateQueries({ queryKey: teamKeys.list(wsId) })
    },
  })
}

export function useAddTeamMember() {
  const qc = useQueryClient()
  const wsId = useWorkspaceId()
  return useMutation({
    mutationFn: ({
      teamId,
      member,
    }: {
      teamId: string
      member: AddTeamMemberRequest
    }) => api.addTeamMember(teamId, member),
    onSuccess: (_member, vars) => {
      qc.invalidateQueries({ queryKey: teamKeys.members(wsId, vars.teamId) })
      qc.invalidateQueries({ queryKey: teamKeys.detail(wsId, vars.teamId) })
      qc.invalidateQueries({ queryKey: teamKeys.list(wsId) })
    },
  })
}

export function useRemoveTeamMember() {
  const qc = useQueryClient()
  const wsId = useWorkspaceId()
  return useMutation({
    mutationFn: ({
      teamId,
      membershipId,
    }: {
      teamId: string
      membershipId: string
    }) => api.removeTeamMember(teamId, membershipId),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: teamKeys.members(wsId, vars.teamId) })
      qc.invalidateQueries({ queryKey: teamKeys.detail(wsId, vars.teamId) })
      qc.invalidateQueries({ queryKey: teamKeys.list(wsId) })
    },
  })
}

export function useTransferTeamOwner() {
  const qc = useQueryClient()
  const wsId = useWorkspaceId()
  return useMutation({
    mutationFn: ({
      teamId,
      ...data
    }: { teamId: string } & TransferTeamOwnerRequest) =>
      api.transferTeamOwner(teamId, data),
    onSuccess: (team) => {
      qc.setQueryData(teamKeys.detail(wsId, team.id), team)
      qc.invalidateQueries({ queryKey: teamKeys.members(wsId, team.id) })
      qc.invalidateQueries({ queryKey: teamKeys.list(wsId) })
    },
  })
}

/**
 * Repository link writes refresh the Team's repository queries, including the
 * picker's linked markers, and the Team issue list the import fills.
 */
function useTeamRepositoryInvalidation() {
  const qc = useQueryClient()
  const wsId = useWorkspaceId()
  return (teamId: string) => {
    qc.invalidateQueries({ queryKey: teamKeys.repositories(wsId, teamId) })
    qc.invalidateQueries({ queryKey: teamKeys.issues(wsId, teamId) })
  }
}

export function useLinkTeamRepository() {
  const invalidate = useTeamRepositoryInvalidation()
  return useMutation({
    mutationFn: ({
      teamId,
      ...data
    }: { teamId: string } & LinkTeamRepositoryRequest) =>
      api.linkTeamRepository(teamId, data),
    onSuccess: (_repository, vars) => invalidate(vars.teamId),
  })
}

export function useUnlinkTeamRepository() {
  const invalidate = useTeamRepositoryInvalidation()
  return useMutation({
    mutationFn: ({
      teamId,
      repositoryId,
    }: {
      teamId: string
      repositoryId: string
    }) => api.unlinkTeamRepository(teamId, repositoryId),
    onSuccess: (_data, vars) => invalidate(vars.teamId),
  })
}

export function useRetryTeamRepositoryImport() {
  const invalidate = useTeamRepositoryInvalidation()
  return useMutation({
    mutationFn: ({
      teamId,
      repositoryId,
    }: {
      teamId: string
      repositoryId: string
    }) => api.retryTeamRepositoryImport(teamId, repositoryId),
    onSuccess: (_repository, vars) => invalidate(vars.teamId),
  })
}

/**
 * Saves workspace invite settings optimistically so the toggle and select
 * respond at once, and restores the previous value if the server refuses.
 */
export function useUpdateWorkspaceTeamSettings() {
  const qc = useQueryClient()
  const wsId = useWorkspaceId()
  const key = teamKeys.inviteSettings(wsId)
  return useMutation({
    mutationFn: (patch: Partial<WorkspaceTeamSettings>) =>
      api.updateWorkspaceTeamSettings(wsId, patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: key })
      const previous = qc.getQueryData<WorkspaceTeamSettings>(key)
      if (previous) qc.setQueryData(key, { ...previous, ...patch })
      return { previous }
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) qc.setQueryData(key, context.previous)
    },
    onSuccess: (settings) => qc.setQueryData(key, settings),
  })
}
