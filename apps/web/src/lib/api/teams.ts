import type {
  TeamAgentPolicy,
  TeamAgentPolicyResponse,
} from '@garden/core/teams/agent-policy'
import type {
  AddTeamMemberRequest,
  CreateTeamRequest,
  LinkTeamRepositoryRequest,
  ListAvailableTeamRepositoriesResponse,
  ListTeamMembersResponse,
  ListTeamRepositoriesResponse,
  ListTeamsResponse,
  Team,
  TeamMember,
  TeamRepository,
  TransferTeamOwnerRequest,
  UpdateTeamRequest,
} from '@garden/core/types'
import { getApiTransport } from './state'

export function listTeams(): Promise<ListTeamsResponse> {
  return getApiTransport().request('/api/teams')
}

export function createTeam(data: CreateTeamRequest): Promise<Team> {
  return getApiTransport().request('/api/teams', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function getTeam(teamId: string): Promise<Team> {
  return getApiTransport().request(`/api/teams/${teamId}`)
}

export function updateTeam(
  teamId: string,
  data: UpdateTeamRequest,
): Promise<Team> {
  return getApiTransport().request(`/api/teams/${teamId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export function deleteTeam(teamId: string): Promise<void> {
  return getApiTransport().request(`/api/teams/${teamId}`, {
    method: 'DELETE',
  })
}

export function listTeamMembers(
  teamId: string,
): Promise<ListTeamMembersResponse> {
  return getApiTransport().request(`/api/teams/${teamId}/members`)
}

export function addTeamMember(
  teamId: string,
  data: AddTeamMemberRequest,
): Promise<TeamMember> {
  return getApiTransport().request(`/api/teams/${teamId}/members`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function removeTeamMember(
  teamId: string,
  membershipId: string,
): Promise<void> {
  return getApiTransport().request(
    `/api/teams/${teamId}/members/${membershipId}`,
    { method: 'DELETE' },
  )
}

export function transferTeamOwner(
  teamId: string,
  data: TransferTeamOwnerRequest,
): Promise<Team> {
  return getApiTransport().request(`/api/teams/${teamId}/owner`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

/** Reads a Team's agent policy, or the no-limits default when none is saved. */
export function getTeamAgentPolicy(
  teamId: string,
): Promise<TeamAgentPolicyResponse> {
  return getApiTransport().request(`/api/teams/${teamId}/agent-policy`)
}

/** Replaces a Team's agent policy. Workspace owners and admins only. */
export function updateTeamAgentPolicy(
  teamId: string,
  policy: TeamAgentPolicy,
): Promise<TeamAgentPolicyResponse> {
  return getApiTransport().request(`/api/teams/${teamId}/agent-policy`, {
    method: 'PUT',
    body: JSON.stringify(policy),
  })
}

export function listTeamRepositories(
  teamId: string,
): Promise<ListTeamRepositoriesResponse> {
  return getApiTransport().request(`/api/teams/${teamId}/repositories`)
}

export function listAvailableTeamRepositories(
  teamId: string,
): Promise<ListAvailableTeamRepositoriesResponse> {
  return getApiTransport().request(
    `/api/teams/${teamId}/repositories/available`,
  )
}

export function linkTeamRepository(
  teamId: string,
  data: LinkTeamRepositoryRequest,
): Promise<TeamRepository> {
  return getApiTransport().request(`/api/teams/${teamId}/repositories`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function unlinkTeamRepository(
  teamId: string,
  repositoryId: string,
): Promise<void> {
  return getApiTransport().request(
    `/api/teams/${teamId}/repositories/${repositoryId}`,
    { method: 'DELETE' },
  )
}

export function retryTeamRepositoryImport(
  teamId: string,
  repositoryId: string,
): Promise<TeamRepository> {
  return getApiTransport().request(
    `/api/teams/${teamId}/repositories/${repositoryId}/retry`,
    { method: 'POST' },
  )
}
