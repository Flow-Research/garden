import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleRealtimeConnect } from './realtime'

const mocks = vi.hoisted(() => ({
  createSessionAuth: vi.fn(),
  getLoggedAuthSession: vi.fn(),
  createAppRequestContext: vi.fn(),
  close: vi.fn(),
  doFetch: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  createSessionAuth: mocks.createSessionAuth,
}))

vi.mock('@/lib/server/context', () => ({
  getLoggedAuthSession: mocks.getLoggedAuthSession,
  createAppRequestContext: mocks.createAppRequestContext,
}))

function fakeDb(responses: unknown[][]) {
  const queue = [...responses]
  const chain: Record<string, unknown> = {}
  chain.select = () => chain
  chain.from = () => chain
  chain.where = () => Promise.resolve(queue.shift() ?? [])
  return chain
}

function makeEnv() {
  return {
    WORKSPACE_REALTIME: {
      idFromName: (name: string) => `do:${name}`,
      get: () => ({ fetch: mocks.doFetch }),
    },
  } as never
}

function upgradeRequest(url = 'https://garden.test/api/realtime?workspace_id=ws-1') {
  return new Request(url, { headers: { upgrade: 'websocket' } })
}

describe('handleRealtimeConnect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.doFetch.mockResolvedValue(new Response(null, { status: 200 }))
    mocks.createAppRequestContext.mockReturnValue({
      db: async () =>
        fakeDb([
          [{ role: 'member' }],
          [{ teamId: 'team-1' }, { teamId: 'team-2' }],
          [{ teamId: 'team-1' }],
        ]),
      close: mocks.close,
    })
    mocks.getLoggedAuthSession.mockResolvedValue({ user: { id: 'user-1' } })
  })

  it('rejects non-upgrade requests', async () => {
    const response = await handleRealtimeConnect(
      new Request('https://garden.test/api/realtime?workspace_id=ws-1'),
      makeEnv(),
    )
    expect(response.status).toBe(426)
  })

  it('requires a workspace id', async () => {
    const response = await handleRealtimeConnect(
      upgradeRequest('https://garden.test/api/realtime'),
      makeEnv(),
    )
    expect(response.status).toBe(400)
  })

  it('rejects unauthenticated upgrades', async () => {
    mocks.getLoggedAuthSession.mockResolvedValue(null)
    const response = await handleRealtimeConnect(upgradeRequest(), makeEnv())
    expect(response.status).toBe(401)
    expect(mocks.doFetch).not.toHaveBeenCalled()
  })

  it('rejects non-members of the workspace', async () => {
    mocks.createAppRequestContext.mockReturnValue({
      db: async () => fakeDb([[]]),
      close: mocks.close,
    })
    const response = await handleRealtimeConnect(upgradeRequest(), makeEnv())
    expect(response.status).toBe(403)
    expect(mocks.doFetch).not.toHaveBeenCalled()
  })

  it('forwards the upgrade with the trusted audience profile', async () => {
    const response = await handleRealtimeConnect(upgradeRequest(), makeEnv())

    expect(response.status).toBe(200)
    expect(mocks.close).toHaveBeenCalled()
    const forwarded = mocks.doFetch.mock.calls[0][0] as Request
    expect(forwarded.headers.get('x-garden-user-id')).toBe('user-1')
    expect(forwarded.headers.get('x-garden-role')).toBe('member')
    expect(forwarded.headers.get('x-garden-team-ids')).toBe('team-1,team-2')
    expect(forwarded.headers.get('x-garden-owned-team-ids')).toBe('team-1')
  })
})
