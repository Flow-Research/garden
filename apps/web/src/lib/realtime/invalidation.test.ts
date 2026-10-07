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
