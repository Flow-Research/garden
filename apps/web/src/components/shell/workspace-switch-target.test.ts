import { describe, expect, it } from 'vitest'
import { workspaceSwitchTarget } from './workspace-switch-target'

describe('workspaceSwitchTarget', () => {
  it('keeps section pages', () => {
    expect(workspaceSwitchTarget('/agents/', '/agents')).toBe('/agents')
    expect(workspaceSwitchTarget('/teams/issues', '/teams/issues')).toBe(
      '/teams/issues',
    )
    expect(
      workspaceSwitchTarget('/settings/preferences', '/settings/preferences'),
    ).toBe('/settings/preferences')
  })

  it('sends entity pages up to their section', () => {
    expect(workspaceSwitchTarget('/agents/$agentId', '/agents/a1')).toBe(
      '/agents',
    )
    expect(workspaceSwitchTarget('/tasks/$issueId', '/tasks/i1')).toBe('/tasks')
    expect(
      workspaceSwitchTarget(
        '/settings/user-management/teams/$teamId',
        '/settings/user-management/teams/t1',
      ),
    ).toBe('/settings/user-management/teams')
  })

  it('treats a splat as a page, not an entity', () => {
    expect(workspaceSwitchTarget('/handbook/$', '/handbook/runs')).toBe(
      '/handbook/runs',
    )
  })

  it('uses the matched section when the current pathname differs', () => {
    expect(workspaceSwitchTarget('/teams/', '/agents/old')).toBe('/teams')
    expect(workspaceSwitchTarget('/handbook/$', '/agents/old')).toBe('/home')
  })

  it('lands on home when the entity has no parent section', () => {
    expect(workspaceSwitchTarget('/$id', '/x1')).toBe('/home')
  })
})
