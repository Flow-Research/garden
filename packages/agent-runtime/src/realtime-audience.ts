import type { RealtimePublishableEvent } from '@garden/core/types'
import {
  canViewTeamIssue,
  isWorkspaceManagerRole,
} from '@garden/db/team-issue-visibility'

/** Trusted connection profile captured when the WebSocket is established. */
export interface RealtimeConnectionProfile {
  userId: string
  role: string
  teamIds: readonly string[]
}

/**
 * Audience gate applied per connection before a frame is sent (spec §8).
 * Team-scoped issue and comment events follow `canViewTeamIssue`, the same
 * rule the issue API enforces, so every member of the Team hears about every
 * change on its board and a refetch never lands on a 403.
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
    // Identifiers only. Members include the Team owner, who reads the policy;
    // other members never hold the policy query, so their refetch is a no-op.
    case 'team:policy_updated':
      return profile.teamIds.includes(event.payload.team_id)
    case 'issue:created':
    case 'issue:updated':
      return canViewTeamIssueEvent(profile, event.payload.issue.team_id)
    case 'issue:deleted':
    case 'comment:created':
    case 'comment:updated':
    case 'comment:deleted':
      return canViewTeamIssueEvent(profile, event.payload.team_id ?? null)
  }
}

function canViewTeamIssueEvent(
  profile: RealtimeConnectionProfile,
  teamId: string | null,
): boolean {
  if (!teamId) return true
  return canViewTeamIssue({
    manager: isWorkspaceManagerRole(profile.role),
    teamMember: profile.teamIds.includes(teamId),
  })
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
      }
    }
    case 'team:deleted':
      return {
        ...profile,
        teamIds: profile.teamIds.filter((id) => id !== event.payload.team_id),
      }
    default:
      return profile
  }
}
