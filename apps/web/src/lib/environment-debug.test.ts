import { describe, expect, it } from 'vitest'
import { DEBUG_SDK_STACK, VIRTUAL_FS_BACKING_STORES } from './environment-debug'

describe('environment-debug metadata', () => {
  it('ships a non-empty SDK stack with required fields', () => {
    expect(DEBUG_SDK_STACK.length).toBeGreaterThan(0)
    for (const sdk of DEBUG_SDK_STACK) {
      expect(sdk.name).toBeTruthy()
      expect(sdk.version).toBeTruthy()
      expect(['stable', 'beta', 'alpha']).toContain(sdk.channel)
    }
  })

  it('lists the DO SQLite + R2 backing stores', () => {
    expect(VIRTUAL_FS_BACKING_STORES).toEqual([
      'Durable Object SQLite',
      'R2 spillover via FILES binding',
    ])
  })
})
