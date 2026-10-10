import type {
  AddTeamMemberRequest,
  CreateTeamRequest,
  ListTeamMembersResponse,
  ListTeamsResponse,
  Team,
  TeamMember,
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
