import type { RealtimePublishableEvent } from '@garden/core/types'

/** Trusted connection profile captured when the WebSocket is established. */
export interface RealtimeConnectionProfile {
  userId: string
  role: string
  teamIds: readonly string[]
  ownedTeamIds: readonly string[]
}

const MANAGER_ROLES = new Set(['owner', 'admin'])

export function isWorkspaceManagerRole(role: string): boolean {
  return MANAGER_ROLES.has(role)
}

/**
 * Audience gate applied per connection before a frame is sent (spec §8).
 * Team-scoped issue events reach a normal member only when assigned to them.
 */
export function canReceiveRealtimeEvent(
  profile: RealtimeConnectionProfile,
  event: RealtimePublishableEvent,
): boolean {
  if (isWorkspaceManagerRole(profile.role)) return true

  switch (event.type) {
    case 'team:created':
    case 'team:updated':
    case 'team:deleted':
    case 'team_member:added':
    case 'team_member:removed':
      return profile.teamIds.includes(event.payload.team_id)
    case 'issue:created':
    case 'issue:updated': {
      const teamId = event.payload.issue.team_id
      if (!teamId) return true
      return (
        profile.ownedTeamIds.includes(teamId) ||
        (profile.teamIds.includes(teamId) &&
          event.payload.issue.assignee_id === profile.userId)
      )
    }
    case 'issue:deleted': {
      const teamId = event.payload.team_id ?? null
      if (!teamId) return true
      return (
        profile.ownedTeamIds.includes(teamId) ||
        (profile.teamIds.includes(teamId) &&
          (event.payload.assignee_id ?? null) === profile.userId)
      )
    }
  }
}

/** Keeps long-lived sockets' audience data fresh from Team events alone. */
export function applyRealtimeProfileUpdate(
  profile: RealtimeConnectionProfile,
  event: RealtimePublishableEvent,
): RealtimeConnectionProfile {
  switch (event.type) {
    case 'team_member:added': {
      if (event.payload.user_id !== profile.userId) return profile
      return {
        ...profile,
        teamIds: [...new Set([...profile.teamIds, event.payload.team_id])],
      }
    }
    case 'team_member:removed': {
      if (event.payload.user_id !== profile.userId) return profile
      return {
        ...profile,
        teamIds: profile.teamIds.filter((id) => id !== event.payload.team_id),
        ownedTeamIds: profile.ownedTeamIds.filter(
          (id) => id !== event.payload.team_id,
        ),
      }
    }
    case 'team:updated': {
      const ownerId = event.payload.team.owner_user_id
      if (ownerId === profile.userId) {
        return {
          ...profile,
          teamIds: [...new Set([...profile.teamIds, event.payload.team_id])],
          ownedTeamIds: [
            ...new Set([...profile.ownedTeamIds, event.payload.team_id]),
          ],
        }
      }
      return {
        ...profile,
        ownedTeamIds: profile.ownedTeamIds.filter(
          (id) => id !== event.payload.team_id,
        ),
      }
    }
    case 'team:deleted':
      return {
        ...profile,
        teamIds: profile.teamIds.filter((id) => id !== event.payload.team_id),
        ownedTeamIds: profile.ownedTeamIds.filter(
          (id) => id !== event.payload.team_id,
        ),
      }
    default:
      return profile
  }
}
