import { beforeEach, describe, expect, it, vi } from 'vitest'

const pgMocks = vi.hoisted(() => ({
  clients: [] as Array<{
    config: Record<string, unknown>
    connect: ReturnType<typeof vi.fn>
    end: ReturnType<typeof vi.fn>
    on: ReturnType<typeof vi.fn>
  }>,
  connectFailures: 0,
  pools: [] as Array<{
    config: Record<string, unknown>
    on: ReturnType<typeof vi.fn>
  }>,
}))

const neonMocks = vi.hoisted(() => ({
  pools: [] as Array<{ connectionString: string }>,
  errorHandlers: [] as Array<(cause: unknown) => void>,
}))

vi.mock('@neondatabase/serverless', () => {
  class MockPool {
    readonly on = vi.fn((event: string, listener: (cause: unknown) => void) => {
      if (event === 'error') neonMocks.errorHandlers.push(listener)
      return this
    })

    constructor(readonly config: { connectionString: string }) {
      neonMocks.pools.push(config)
    }
  }

  return {
    Client: class MockClient {},
    Pool: MockPool,
  }
})

vi.mock('pg', () => {
  class MockClient {
    readonly connect = vi.fn(async () => {
      if (pgMocks.connectFailures > 0) {
        pgMocks.connectFailures -= 1
        return await Promise.reject(new Error('transient connect failure'))
      }
    })
    readonly end = vi.fn(async () => {})
    readonly on = vi.fn(() => this)

    constructor(readonly config: Record<string, unknown>) {
      pgMocks.clients.push(this)
    }
  }

  class MockPool {
    readonly on = vi.fn(() => this)

    constructor(readonly config: Record<string, unknown>) {
      pgMocks.pools.push(this)
    }
  }

  return {
    Client: MockClient,
    Pool: MockPool,
    default: { Pool: MockPool },
  }
})

import {
  createDb,
  createRuntimeDbClient,
  getPooledDb,
  getWorkerPooledDb,
} from '../runtime.js'

describe('runtime database lifecycle', () => {
  beforeEach(() => {
    pgMocks.clients.length = 0
    pgMocks.connectFailures = 0
    pgMocks.pools.length = 0
    neonMocks.pools.length = 0
    neonMocks.errorHandlers.length = 0
  })

  it('keeps local Worker calls off the raw-TCP Hyperdrive bridge', () => {
    getWorkerPooledDb({
      environment: 'development',
      directConnectionString: 'postgres://garden.test/direct',
      hyperdrive: { connectionString: 'postgres://garden.test/hyperdrive' },
    })

    expect(neonMocks.pools).toHaveLength(1)
    expect(neonMocks.pools[0]).toMatchObject({
      connectionString: 'postgres://garden.test/direct',
    })
    expect(pgMocks.pools).toHaveLength(0)
  })

  it('keeps deployed Worker calls on Hyperdrive', () => {
    getWorkerPooledDb({
      environment: 'production',
      directConnectionString: 'postgres://garden.test/direct',
      hyperdrive: { connectionString: 'postgres://garden.test/hyperdrive' },
    })

    expect(neonMocks.pools).toHaveLength(0)
    expect(pgMocks.pools[0]?.config).toMatchObject({
      connectionString: 'postgres://garden.test/hyperdrive',
    })
  })

  it('never logs connection parameters from a Neon error event', () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    getWorkerPooledDb({
      environment: 'development',
      directConnectionString: 'postgres://garden.test/direct',
    })

    neonMocks.errorHandlers[0]?.({
      error: new Error('Network connection lost.'),
      pool: { password: 'must-not-appear' },
    })

    expect(errorLog).toHaveBeenCalledWith(
      '[garden-db] idle development PostgreSQL client failed',
      { message: 'Network connection lost.' },
    )
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('must-not-appear')
    errorLog.mockRestore()
  })

  it('bounds Promise-only callers to one short-lived pool with an idle error listener', async () => {
    getPooledDb('postgres://garden.test/database')
    await createDb({ connectionString: 'postgres://garden.test/database' })

    expect(pgMocks.pools).toHaveLength(2)
    for (const pool of pgMocks.pools) {
      expect(pool.config).toMatchObject({
        max: 1,
        idleTimeoutMillis: 250,
        connectionTimeoutMillis: 5_000,
        allowExitOnIdle: true,
      })
      expect(pool.on).toHaveBeenCalledWith('error', expect.any(Function))
    }
    expect(pgMocks.clients).toHaveLength(0)
  })

  it('retries only connection acquisition and releases every failed client', async () => {
    pgMocks.connectFailures = 2

    const runtime = await createRuntimeDbClient({
      connectionString: 'postgres://garden.test/database',
    })

    expect(pgMocks.clients).toHaveLength(3)
    expect(pgMocks.clients[0]?.end).toHaveBeenCalledOnce()
    expect(pgMocks.clients[1]?.end).toHaveBeenCalledOnce()
    expect(pgMocks.clients[2]?.end).not.toHaveBeenCalled()
    for (const client of pgMocks.clients) {
      expect(client.config).toMatchObject({ connectionTimeoutMillis: 5_000 })
      expect(client.on).toHaveBeenCalledWith('error', expect.any(Function))
    }

    await runtime.close()
    expect(pgMocks.clients[2]?.end).toHaveBeenCalledOnce()
  })
})
