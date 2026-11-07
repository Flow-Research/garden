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
}

const outsider: RealtimeConnectionProfile = {
  userId: 'user-outsider',
  role: 'member',
  teamIds: ['team-2'],
}

const manager: RealtimeConnectionProfile = {
  userId: 'user-admin',
  role: 'admin',
  teamIds: [],
}

const teamUpdated: RealtimePublishableEvent = {
  type: 'team:updated',
  payload: {
    workspace_id: 'ws-1',
    team_id: 'team-1',
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
      canReceiveRealtimeEvent(
        manager,
        issueEvent('issue:updated', 'team-1', null),
      ),
    ).toBe(true)
  })

  it('delivers Team events only to members of that Team', () => {
    expect(canReceiveRealtimeEvent(member, teamUpdated)).toBe(true)
    expect(canReceiveRealtimeEvent(outsider, teamUpdated)).toBe(false)
  })

  it('delivers every Team issue event to every member of that Team', () => {
    for (const assigneeId of ['user-member', 'someone-else', null]) {
      expect(
        canReceiveRealtimeEvent(
          member,
          issueEvent('issue:updated', 'team-1', assigneeId),
        ),
      ).toBe(true)
      expect(
        canReceiveRealtimeEvent(
          outsider,
          issueEvent('issue:updated', 'team-1', assigneeId),
        ),
      ).toBe(false)
    }
  })

  it('delivers Team issue deletions to members of that Team only', () => {
    const deleted: RealtimePublishableEvent = {
      type: 'issue:deleted',
      payload: { issue_id: 'issue-1', team_id: 'team-1' },
    }
    expect(canReceiveRealtimeEvent(member, deleted)).toBe(true)
    expect(canReceiveRealtimeEvent(outsider, deleted)).toBe(false)
    expect(canReceiveRealtimeEvent(manager, deleted)).toBe(true)
  })

  it('gates comment events like the issue they belong to', () => {
    const comment = (teamId: string | null): RealtimePublishableEvent => ({
      type: 'comment:created',
      payload: {
        issue_id: 'issue-1',
        comment_id: 'comment-1',
        team_id: teamId,
      },
    })
    expect(canReceiveRealtimeEvent(outsider, comment(null))).toBe(true)
    expect(canReceiveRealtimeEvent(member, comment('team-1'))).toBe(true)
    expect(canReceiveRealtimeEvent(outsider, comment('team-1'))).toBe(false)
    expect(canReceiveRealtimeEvent(manager, comment('team-1'))).toBe(true)
  })

  it('delivers workspace issue events to every member', () => {
    expect(
      canReceiveRealtimeEvent(
        outsider,
        issueEvent('issue:created', null, null),
      ),
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

  it('hears Team issue events right after joining and stops after leaving', () => {
    const event = issueEvent('issue:updated', 'team-1', 'someone-else')
    expect(canReceiveRealtimeEvent(outsider, event)).toBe(false)

    const joined = applyRealtimeProfileUpdate(outsider, teamMemberAdded)
    expect(canReceiveRealtimeEvent(joined, event)).toBe(true)

    const left = applyRealtimeProfileUpdate(joined, {
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
    expect(canReceiveRealtimeEvent(left, event)).toBe(false)
  })

  it('drops deleted Teams from every profile', () => {
    const updated = applyRealtimeProfileUpdate(member, {
      type: 'team:deleted',
      payload: { workspace_id: 'ws-1', team_id: 'team-1' },
    })
    expect(updated.teamIds).toEqual([])
  })
})
