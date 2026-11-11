import { afterEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@garden/core/types'
import { useAuthStore } from '@garden/app-state/auth'
import { configureApi } from './state'
import { listSkills } from './skills'

vi.mock('@/lib/auth/client', () => ({
  authClient: { organization: { setActive: vi.fn() } },
}))

afterEach(() => {
  vi.restoreAllMocks()
  useAuthStore.setState({ user: null })
})

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function setup(origin = 'https://garden.test') {
  const onUnauthorized = vi.fn()
  const transport = configureApi(origin, { onUnauthorized })
  transport.setWorkspaceId('workspace-a')
  return { transport, onUnauthorized }
}

function delayedFetch() {
  const response = deferred<Response>()
  const started = deferred<void>()
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    started.resolve()
    return response.promise
  })
  return { response, started: started.promise, fetch }
}

describe('web skills session adapter', () => {
  it('uses each newly configured origin and web cookie transport', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => Response.json([]))
    setup('https://first.test')
    await listSkills({ workspace_id: 'workspace-a' })
    setup('https://second.test')
    await listSkills({ workspace_id: 'workspace-a' })
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      'https://first.test/api/skills',
    )
    expect(String(fetch.mock.calls[1]?.[0])).toBe(
      'https://second.test/api/skills',
    )
    expect(fetch.mock.calls[1]?.[1]?.credentials).toBe('include')
  })

  it('rejects a missing or mismatched workspace before sending', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    const { transport } = setup()
    await expect(listSkills({ workspace_id: 'workspace-b' })).rejects.toThrow(
      'active workspace',
    )
    transport.setWorkspaceId(null)
    await expect(listSkills()).rejects.toThrow('active workspace')
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['workspace', 'account', 'reconfigure'])(
    'rejects old responses after %s changes, including switching away and back',
    async (change) => {
      const { transport } = setup()
      useAuthStore.setState({ user: { id: 'account-a' } as User })
      const delayed = delayedFetch()
      const pending = listSkills()
      const rejected = expect(pending).rejects.toThrow(Error)
      await delayed.started
      if (change === 'workspace') {
        transport.setWorkspaceId('workspace-b')
        transport.setWorkspaceId('workspace-a')
      } else if (change === 'account') {
        useAuthStore.setState({ user: { id: 'account-b' } as User })
        useAuthStore.setState({ user: { id: 'account-a' } as User })
      } else setup('https://next.test')
      delayed.response.resolve(Response.json([]))
      await rejected
      delayed.fetch.mockResolvedValue(Response.json([]))
      await expect(listSkills()).resolves.toEqual([])
    },
  )

  it('cannot sign out a new workspace when an old read returns 401', async () => {
    const { transport, onUnauthorized } = setup()
    const delayed = delayedFetch()
    const pending = listSkills()
    const rejected = expect(pending).rejects.toThrow(Error)
    await delayed.started
    transport.setWorkspaceId('workspace-b')
    delayed.response.resolve(
      Response.json(
        { _tag: 'SkillUnauthorizedError', message: 'Expired' },
        { status: 401 },
      ),
    )
    await rejected
    expect(onUnauthorized).not.toHaveBeenCalled()
    expect(transport.getWorkspaceId()).toBe('workspace-b')
  })

  it('expires the current session on 401, preserving 403 as denied access', async () => {
    const { transport, onUnauthorized } = setup()
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        Response.json(
          { _tag: 'SkillForbiddenError', message: 'Forbidden' },
          { status: 403 },
        ),
      )
    await expect(listSkills()).rejects.toThrow(Error)
    expect(transport.getWorkspaceId()).toBe('workspace-a')
    expect(onUnauthorized).not.toHaveBeenCalled()
    fetch.mockResolvedValue(
      Response.json(
        { _tag: 'SkillUnauthorizedError', message: 'Expired' },
        { status: 401 },
      ),
    )
    await expect(listSkills()).rejects.toThrow(Error)
    expect(transport.getWorkspaceId()).toBeNull()
    expect(onUnauthorized).toHaveBeenCalledOnce()
  })
})
