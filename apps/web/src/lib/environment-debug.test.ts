import { describe, expect, it } from 'vitest'
import { createEnvironmentDebugSnapshot } from './environment-debug'

describe('createEnvironmentDebugSnapshot', () => {
  it('reports presence without leaking bound secret values', () => {
    const snapshot = createEnvironmentDebugSnapshot({
      PrimaryAgent: {} as Env['PrimaryAgent'],
      Sandbox: {} as Env['Sandbox'],
      FILES: {} as Env['FILES'],
      LOADER: {} as Env['LOADER'],
      SANDBOX_TRANSPORT: 'websocket',
      DATABASE_URL: 'postgres://user:secret-pass@db.example.com:5432/garden',
      BETTER_AUTH_SECRET: 'super-secret-auth-value',
      BETTER_AUTH_URL: 'https://garden.example.com',
      OPENCODE_GO_API_KEY: 'test-api-key-value',
    })

    expect(snapshot.runtime.bindings.every((item) => item.available)).toBe(true)
    expect(snapshot.runtime.variables).toEqual([
      expect.objectContaining({
        name: 'SANDBOX_TRANSPORT',
        available: true,
      }),
    ])
    expect(snapshot.runtime.secrets).toEqual([
      expect.objectContaining({ name: 'DATABASE_URL', available: true }),
      expect.objectContaining({ name: 'BETTER_AUTH_SECRET', available: true }),
      expect.objectContaining({ name: 'BETTER_AUTH_URL', available: true }),
      expect.objectContaining({ name: 'OPENCODE_GO_API_KEY', available: true }),
    ])

    const serialized = JSON.stringify(snapshot)
    expect(serialized).not.toContain('secret-pass')
    expect(serialized).not.toContain('super-secret-auth-value')
    expect(serialized).not.toContain('test-api-key-value')
    expect(serialized).not.toContain('https://garden.example.com')
  })

  it('marks missing bindings and secrets as unavailable', () => {
    const snapshot = createEnvironmentDebugSnapshot({})

    expect(snapshot.runtime.bindings.every((item) => !item.available)).toBe(
      true,
    )
    expect(snapshot.runtime.secrets.every((item) => !item.available)).toBe(
      true,
    )
    expect(snapshot.runtime.variables).toEqual([
      expect.objectContaining({
        name: 'SANDBOX_TRANSPORT',
        available: false,
      }),
    ])
  })
})
