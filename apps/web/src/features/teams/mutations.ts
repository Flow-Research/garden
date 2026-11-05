import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useWorkspaceId } from '@garden/app-state/hooks'
import type {
  AddTeamMemberRequest,
  CreateTeamRequest,
  TransferTeamOwnerRequest,
  UpdateTeamRequest,
} from '@garden/core/types'
import type {
  TeamAgentPolicy,
  TeamAgentPolicyResponse,
} from '@garden/core/teams/agent-policy'
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
 * Saves a Team's agent policy optimistically: the cache shows the new policy
 * at once, rolls back if the server refuses it, and takes the server's copy on
 * success so `updated_at` is authoritative.
 */
export function useUpdateTeamAgentPolicy(teamId: string) {
  const qc = useQueryClient()
  const wsId = useWorkspaceId()
  const queryKey = teamKeys.agentPolicy(wsId, teamId)
  return useMutation({
    mutationFn: (policy: TeamAgentPolicy) =>
      api.updateTeamAgentPolicy(teamId, policy),
    onMutate: async (policy) => {
      await qc.cancelQueries({ queryKey })
      const previous = qc.getQueryData<TeamAgentPolicyResponse>(queryKey)
      if (previous) qc.setQueryData(queryKey, { ...previous, policy })
      return { previous }
    },
    onError: (_error, _policy, context) => {
      if (context?.previous) qc.setQueryData(queryKey, context.previous)
    },
    onSuccess: (saved) => {
      qc.setQueryData(queryKey, saved)
    },
  })
}
