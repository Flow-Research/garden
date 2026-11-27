// @vitest-environment node
import { Effect } from 'effect'
import { beforeEach, expect, it, vi } from 'vitest'
import { settleOAuthCallback } from './callback'

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  syncCapabilities: vi.fn(),
  mirrorExecutorConnection: vi.fn(),
}))

vi.mock('@/lib/server/executor-runtime', () => ({
  executorProgram: (
    _identity: unknown,
    runWithExecutor: (executor: unknown) => unknown,
  ) => runWithExecutor({ oauth: { complete: mocks.complete } }),
}))
vi.mock('@/lib/server/capability-sync', () => ({
  syncCapabilities: mocks.syncCapabilities,
}))
vi.mock('@/lib/server/executor-engine/connection-mirror', () => ({
  mirrorExecutorConnection: mocks.mirrorExecutorConnection,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.complete.mockReturnValue(
    Effect.succeed({
      owner: 'org',
      integration: 'google_drive',
      name: 'company',
    }),
  )
  mocks.syncCapabilities.mockReturnValue(Effect.succeed(undefined))
})

it('syncs an org OAuth connection with the verified actor and no user mirror', async () => {
  const result = await Effect.runPromise(
    settleOAuthCallback({
      identity: { tenant: 'workspace-a', subject: 'admin-a' },
      state: 'state',
      code: 'code',
      providerError: null,
      providerErrorDescription: null,
    }),
  )

  expect(result).toEqual({ ok: true })
  expect(mocks.syncCapabilities).toHaveBeenCalledWith(
    'google-drive',
    'admin-a',
    'workspace-a',
  )
  expect(mocks.mirrorExecutorConnection).not.toHaveBeenCalled()
})

it('keeps the completed org connection when its tools need a resync', async () => {
  mocks.syncCapabilities.mockReturnValue(
    Effect.fail(new Error('Catalog unavailable')),
  )
  const result = await Effect.runPromise(
    settleOAuthCallback({
      identity: { tenant: 'workspace-a', subject: 'admin-a' },
      state: 'state',
      code: 'code',
      providerError: null,
      providerErrorDescription: null,
    }),
  )
  expect(result).toEqual({
    ok: true,
    warning: expect.stringContaining('Resync'),
  })
  expect(mocks.complete).toHaveBeenCalledOnce()
})
