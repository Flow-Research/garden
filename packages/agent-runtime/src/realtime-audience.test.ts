import { describe, expect, it } from 'vitest'
import type { RealtimePublishableEvent } from '@garden/core/types'
import {
  applyRealtimeProfileUpdate,
  canReceiveRealtimeEvent,
  type RealtimeConnectionProfile,
} from './realtime-audience'

const member: RealtimeConnectionProfile = {
  userId: 'user-member',
  role: 'member',
  teamIds: ['team-1'],
  ownedTeamIds: [],
}

const teamOwner: RealtimeConnectionProfile = {
  userId: 'user-owner',
  role: 'member',
  teamIds: ['team-1'],
  ownedTeamIds: ['team-1'],
}

const outsider: RealtimeConnectionProfile = {
  userId: 'user-outsider',
  role: 'member',
  teamIds: ['team-2'],
  ownedTeamIds: [],
}

const manager: RealtimeConnectionProfile = {
  userId: 'user-admin',
  role: 'admin',
  teamIds: [],
  ownedTeamIds: [],
}

const teamUpdated: RealtimePublishableEvent = {
  type: 'team:updated',
  payload: {
    workspace_id: 'ws-1',
    team_id: 'team-1',
    team: {} as never,
  },
}

const teamMemberAdded: RealtimePublishableEvent = {
  type: 'team_member:added',
  payload: {
    workspace_id: 'ws-1',
    team_id: 'team-1',
    membership_id: 'tm-1',
    member_type: 'user',
    user_id: 'user-outsider',
    agent_id: null,
  },
}

function issueEvent(
  type: 'issue:created' | 'issue:updated',
  teamId: string | null,
  assigneeId: string | null,
): RealtimePublishableEvent {
  return {
    type,
    payload: {
      issue: {
        team_id: teamId,
        assignee_id: assigneeId,
      } as never,
    },
  }
}

describe('canReceiveRealtimeEvent', () => {
  it('delivers everything to workspace managers', () => {
    expect(canReceiveRealtimeEvent(manager, teamUpdated)).toBe(true)
    expect(
      canReceiveRealtimeEvent(manager, issueEvent('issue:updated', 'team-1', null)),
    ).toBe(true)
  })

  it('delivers Team events only to members of that Team', () => {
    expect(canReceiveRealtimeEvent(member, teamUpdated)).toBe(true)
    expect(canReceiveRealtimeEvent(outsider, teamUpdated)).toBe(false)
  })

  it('delivers a Team issue event to a member only when assigned', () => {
    expect(
      canReceiveRealtimeEvent(
        member,
        issueEvent('issue:updated', 'team-1', 'user-member'),
      ),
    ).toBe(true)
    expect(
      canReceiveRealtimeEvent(
        member,
        issueEvent('issue:updated', 'team-1', 'someone-else'),
      ),
    ).toBe(false)
  })

  it('delivers Team issue events to the Team owner even when unassigned', () => {
    expect(
      canReceiveRealtimeEvent(
        teamOwner,
        issueEvent('issue:updated', 'team-1', 'someone-else'),
      ),
    ).toBe(true)
  })

  it('gates Team issue deletions on the assignee', () => {
    const deleted: RealtimePublishableEvent = {
      type: 'issue:deleted',
      payload: {
        issue_id: 'issue-1',
        team_id: 'team-1',
        assignee_id: 'user-member',
      },
    }
    expect(canReceiveRealtimeEvent(member, deleted)).toBe(true)
    expect(canReceiveRealtimeEvent(outsider, deleted)).toBe(false)

    const deletedUnassigned: RealtimePublishableEvent = {
      type: 'issue:deleted',
      payload: { issue_id: 'issue-2', team_id: 'team-1', assignee_id: null },
    }
    expect(canReceiveRealtimeEvent(member, deletedUnassigned)).toBe(false)
    expect(canReceiveRealtimeEvent(teamOwner, deletedUnassigned)).toBe(true)
  })

  it('delivers workspace issue events to every member', () => {
    expect(
      canReceiveRealtimeEvent(outsider, issueEvent('issue:created', null, null)),
    ).toBe(true)
  })
})

describe('applyRealtimeProfileUpdate', () => {
  it('adds and removes team memberships for the affected user', () => {
    const added = applyRealtimeProfileUpdate(outsider, teamMemberAdded)
    expect(added.teamIds).toEqual(['team-2', 'team-1'])

    const removed = applyRealtimeProfileUpdate(added, {
      type: 'team_member:removed',
      payload: {
        workspace_id: 'ws-1',
        team_id: 'team-1',
        membership_id: 'tm-1',
        member_type: 'user',
        user_id: 'user-outsider',
        agent_id: null,
      },
    })
    expect(removed.teamIds).toEqual(['team-2'])
  })

  it('leaves other users untouched', () => {
    expect(applyRealtimeProfileUpdate(member, teamMemberAdded)).toEqual(member)
  })

  it('moves ownership with an owner transfer', () => {
    const newOwner = applyRealtimeProfileUpdate(member, {
      type: 'team:updated',
      payload: {
        workspace_id: 'ws-1',
        team_id: 'team-1',
        team: { owner_user_id: 'user-member' } as never,
      },
    })
    expect(newOwner.ownedTeamIds).toEqual(['team-1'])

    const previousOwner = applyRealtimeProfileUpdate(teamOwner, {
      type: 'team:updated',
      payload: {
        workspace_id: 'ws-1',
        team_id: 'team-1',
        team: { owner_user_id: 'user-member' } as never,
      },
    })
    expect(previousOwner.ownedTeamIds).toEqual([])
  })

  it('drops deleted Teams from every profile', () => {
    const updated = applyRealtimeProfileUpdate(teamOwner, {
      type: 'team:deleted',
      payload: { workspace_id: 'ws-1', team_id: 'team-1', name: 'Alpha' },
    })
    expect(updated.teamIds).toEqual([])
    expect(updated.ownedTeamIds).toEqual([])
  })
})
