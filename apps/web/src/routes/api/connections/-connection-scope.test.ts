import { describe, expect, it } from 'vitest'
import { isPersonalOnlyConnectionAction } from './$connectorId'

describe('isPersonalOnlyConnectionAction', () => {
  it('allows delete and disconnect on personal-only connections', () => {
    expect(isPersonalOnlyConnectionAction('delete', ['user'])).toBe(true)
    expect(isPersonalOnlyConnectionAction('disconnect', ['user', 'user'])).toBe(
      true,
    )
  })

  it('requires the gate when any connection is workspace-owned', () => {
    expect(isPersonalOnlyConnectionAction('delete', ['user', 'org'])).toBe(
      false,
    )
    expect(isPersonalOnlyConnectionAction('disconnect', ['org'])).toBe(false)
  })

  it('requires the gate for non-destructive actions and empty lists', () => {
    expect(isPersonalOnlyConnectionAction('resync', ['user'])).toBe(false)
    expect(isPersonalOnlyConnectionAction('connect', ['user'])).toBe(false)
    expect(isPersonalOnlyConnectionAction('delete', [])).toBe(false)
  })
})
