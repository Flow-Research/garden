import { describe, expect, it } from 'vitest'
import { resolvePreferredWorkspaceId } from './auth-bootstrap'

describe('resolvePreferredWorkspaceId', () => {
  const orgs = [{ id: 'ws-a' }, { id: 'ws-b' }]

  it('prefers an explicit workspace_id that the user belongs to', () => {
    expect(resolvePreferredWorkspaceId(orgs, 'ws-b', 'ws-a')).toBe('ws-b')
  })

  it('ignores workspace_id outside the membership list', () => {
    expect(resolvePreferredWorkspaceId(orgs, 'ws-other', 'ws-a')).toBe('ws-a')
  })

  it('uses the session active org when no request id is present', () => {
    expect(resolvePreferredWorkspaceId(orgs, null, 'ws-b')).toBe('ws-b')
  })

  it('falls back to the first membership when active org is missing', () => {
    expect(resolvePreferredWorkspaceId(orgs, null, null)).toBe('ws-a')
  })

  it('returns null when the user has no workspaces', () => {
    expect(resolvePreferredWorkspaceId([], null, null)).toBeNull()
  })
})
