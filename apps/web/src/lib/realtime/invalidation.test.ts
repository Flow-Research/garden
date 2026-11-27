import { describe, expect, it } from 'vitest'
import { realtimeInvalidationRoots } from './invalidation'

describe('realtimeInvalidationRoots', () => {
  it('invalidates the Teams root for Team and membership events', () => {
    for (const type of [
      'team:created',
      'team:updated',
      'team:deleted',
      'team_member:added',
      'team_member:removed',
      'team_member:updated',
    ]) {
      expect(
        realtimeInvalidationRoots({ type, workspace_id: 'ws-1' }, 'ws-1'),
      ).toEqual([['teams', 'ws-1']])
    }
  })

  it('invalidates the issues root for issue events', () => {
    expect(
      realtimeInvalidationRoots(
        { type: 'issue:updated', workspace_id: 'ws-1' },
        'ws-1',
      ),
    ).toEqual([['issues', 'ws-1']])
  })

  it("also refreshes an updated issue's own resources", () => {
    expect(
      realtimeInvalidationRoots(
        {
          type: 'issue:updated',
          workspace_id: 'ws-1',
          payload: { issue: { id: 'issue-1' } },
        },
        'ws-1',
      ),
    ).toEqual([
      ['issues', 'ws-1'],
      ['issues', 'timeline', 'issue-1'],
      ['issues', 'subscribers', 'issue-1'],
      ['issue-pending-approval', 'issue-1'],
    ])
  })

  it("refreshes the issue's timeline for comment events", () => {
    for (const type of [
      'comment:created',
      'comment:updated',
      'comment:deleted',
    ]) {
      expect(
        realtimeInvalidationRoots(
          {
            type,
            workspace_id: 'ws-1',
            payload: { issue_id: 'issue-1', comment_id: 'comment-1' },
          },
          'ws-1',
        ),
      ).toEqual([['issues', 'timeline', 'issue-1']])
    }
    expect(
      realtimeInvalidationRoots(
        { type: 'comment:created', workspace_id: 'ws-1', payload: {} },
        'ws-1',
      ),
    ).toBeNull()
  })

  it('ignores foreign workspaces, unknown types, and malformed frames', () => {
    expect(
      realtimeInvalidationRoots(
        { type: 'team:updated', workspace_id: 'ws-2' },
        'ws-1',
      ),
    ).toBeNull()
    expect(
      realtimeInvalidationRoots(
        { type: 'inbox:new', workspace_id: 'ws-1' },
        'ws-1',
      ),
    ).toBeNull()
    expect(realtimeInvalidationRoots({}, 'ws-1')).toBeNull()
  })
})
