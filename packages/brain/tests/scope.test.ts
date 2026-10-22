import { describe, expect, it } from 'vitest'
import {
  canViewScope,
  narrowestScope,
  orgScope,
  scopeKey,
  teamScope,
  userScope,
  type BrainScope,
  type ScopeViewer,
} from '../src/domain/scope.ts'

const viewer = (input: {
  teamIds?: readonly string[]
  userId?: string
}): ScopeViewer => ({
  teamIds: new Set(input.teamIds ?? []),
  userId: input.userId,
})

describe('canViewScope', () => {
  it('shows org scope to every viewer', () => {
    expect(canViewScope(orgScope(), viewer({}))).toBe(true)
  })

  it('shows team scope only to team members', () => {
    const scope = teamScope('t1')
    expect(canViewScope(scope, viewer({ teamIds: ['t1'] }))).toBe(true)
    expect(canViewScope(scope, viewer({ teamIds: ['t2'] }))).toBe(false)
    expect(canViewScope(scope, viewer({}))).toBe(false)
  })

  it('shows user scope only to the matching user', () => {
    const scope = userScope('u1')
    expect(canViewScope(scope, viewer({ userId: 'u1' }))).toBe(true)
    expect(canViewScope(scope, viewer({ userId: 'u2' }))).toBe(false)
    expect(canViewScope(scope, viewer({}))).toBe(false)
  })
})

describe('scopeKey', () => {
  it('distinguishes the three scopes and their targets', () => {
    expect(scopeKey(orgScope())).toBe('org')
    expect(scopeKey(teamScope('t1'))).toBe('team:t1')
    expect(scopeKey(userScope('u1'))).toBe('user:u1')
  })
})

describe('narrowestScope', () => {
  it('fails closed for no sources and returns org for org-only', () => {
    expect(narrowestScope([])).toBeUndefined()
    expect(narrowestScope([orgScope()])).toEqual(orgScope())
  })

  it('drops org scopes in favor of a narrower source', () => {
    expect(narrowestScope([orgScope(), teamScope('t1')])).toEqual(
      teamScope('t1'),
    )
    expect(narrowestScope([orgScope(), userScope('u1')])).toEqual(
      userScope('u1'),
    )
  })

  it('keeps a single shared restricted scope', () => {
    expect(narrowestScope([teamScope('t1'), teamScope('t1')])).toEqual(
      teamScope('t1'),
    )
    expect(narrowestScope([userScope('u1'), userScope('u1')])).toEqual(
      userScope('u1'),
    )
  })

  it('refuses to derive when two incomparable scopes are mixed', () => {
    const cases: readonly BrainScope[][] = [
      [teamScope('t1'), teamScope('t2')],
      [userScope('u1'), userScope('u2')],
      [teamScope('t1'), userScope('u1')],
      [orgScope(), teamScope('t1'), userScope('u1')],
    ]
    for (const scopes of cases) {
      expect(narrowestScope(scopes)).toBeUndefined()
    }
  })
})
