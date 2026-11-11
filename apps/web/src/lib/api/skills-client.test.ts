// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { once } from 'node:events'
import type { Skill } from '@garden/core/skills'
import { createSkillsClient, type SkillsClientOptions } from './skills-client'

const skill = (workspaceId = 'workspace-a'): Skill => ({
  id: 'skill-1',
  workspace_id: workspaceId,
  slug: 'review',
  name: 'Review',
  description: 'Review code',
  content: '# Review',
  config: { name: 'Review', description: 'Review code' },
  files: [],
  source_type: 'manual',
  source_url: null,
  bundle_hash: null,
  created_by: null,
  created_at: '2026-11-11',
  updated_at: '2026-11-11',
})

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function options(
  overrides: Partial<SkillsClientOptions> = {},
): SkillsClientOptions {
  return {
    origin: 'https://garden.test',
    workspaceId: 'workspace-a',
    sessionId: 'account-a:1',
    fetch: vi.fn(async () => Response.json([skill()])),
    createRequestId: () => 'request-1',
    ...overrides,
  }
}

function delayedTransport() {
  let resolve!: (response: Response) => void
  const started = deferred<void>()
  const fetch = vi.fn<typeof globalThis.fetch>((_input, _init) => {
    started.resolve()
    return new Promise<Response>((done) => {
      resolve = done
    })
  })
  return {
    fetch,
    started: started.promise,
    respond: (response: Response) => resolve(response),
  }
}

afterEach(() => vi.restoreAllMocks())

describe('portable skills client', () => {
  it('uses the declared origin, workspace and request ID, without browser globals', async () => {
    expect(typeof window).toBe('undefined')
    const config = options()
    const client = createSkillsClient(config)
    expect(await client.listSkills()).toEqual([skill()])
    const call = vi.mocked(config.fetch).mock.calls[0]
    expect(String(call?.[0])).toBe('https://garden.test/api/skills')
    expect(new Headers(call?.[1]?.headers).get('x-workspace-id')).toBe(
      'workspace-a',
    )
    expect(new Headers(call?.[1]?.headers).get('x-request-id')).toBe(
      'request-1',
    )
    expect(call?.[1]?.credentials).toBeUndefined()
  })

  it.each([
    ['file:///tmp/test', 'workspace-a', 'session'],
    ['https://user:secret@garden.test', 'workspace-a', 'session'],
    ['https://garden.test/prefix', 'workspace-a', 'session'],
    ['https://garden.test', '', 'session'],
    ['https://garden.test', 'workspace-a', ''],
  ])('rejects invalid scope %s %s %s', (origin, workspaceId, sessionId) => {
    expect(() =>
      createSkillsClient(options({ origin, workspaceId, sessionId })),
    ).toThrow(Error)
  })

  it('captures its configuration instead of reading caller mutations', async () => {
    const config = options()
    const client = createSkillsClient(config)
    config.origin = 'https://changed.test'
    config.workspaceId = 'workspace-b'
    config.fetch = vi.fn(async () => {
      throw new Error('Replacement transport')
    })
    await expect(client.listSkills()).resolves.toEqual([skill()])
    expect(config.fetch).not.toHaveBeenCalled()
    expect(client.scope.origin).toBe('https://garden.test')
    expect(client.scope.workspaceId).toBe('workspace-a')
  })

  it('keeps independent origins and workspace sessions separate', async () => {
    const a = options()
    const b = options({
      origin: 'https://other.test',
      workspaceId: 'workspace-b',
      sessionId: 'account-b:1',
      fetch: vi.fn(async () => Response.json([skill('workspace-b')])),
    })
    await Promise.all([
      createSkillsClient(a).listSkills(),
      createSkillsClient(b).listSkills(),
    ])
    expect(String(vi.mocked(b.fetch).mock.calls[0]?.[0])).toBe(
      'https://other.test/api/skills',
    )
    expect(
      new Headers(vi.mocked(a.fetch).mock.calls[0]?.[1]?.headers).get(
        'x-workspace-id',
      ),
    ).toBe('workspace-a')
  })

  it.each([401, 403])(
    'reports HTTP %s with the contract error and only expires on 401',
    async (status) => {
      const onUnauthorized = vi.fn()
      const client = createSkillsClient(
        options({
          onUnauthorized,
          fetch: vi.fn(async () =>
            Response.json(
              {
                _tag:
                  status === 401
                    ? 'SkillUnauthorizedError'
                    : 'SkillForbiddenError',
                message: 'Access refused',
              },
              { status },
            ),
          ),
        }),
      )
      await expect(client.listSkills()).rejects.toThrow(Error)
      expect(onUnauthorized).toHaveBeenCalledTimes(status === 401 ? 1 : 0)
      await expect(client.listSkills()).rejects.toThrow(Error)
    },
  )

  it('accepts an empty catalog', async () => {
    const client = createSkillsClient(
      options({ fetch: vi.fn(async () => Response.json([])) }),
    )
    await expect(client.listSkills()).resolves.toEqual([])
  })

  it.each([{ payload: [{ id: 'incomplete' }] }, { payload: { skills: [] } }])(
    'rejects malformed response $payload',
    async ({ payload }) => {
      const client = createSkillsClient(
        options({ fetch: vi.fn(async () => Response.json(payload)) }),
      )
      await expect(client.listSkills()).rejects.toThrow(Error)
    },
  )

  it('rejects a well-formed response belonging to another workspace', async () => {
    const client = createSkillsClient(
      options({
        fetch: vi.fn(async () => Response.json([skill('workspace-b')])),
      }),
    )
    await expect(client.listSkills()).rejects.toThrow('Response workspace')
  })

  it('reports network failure without treating it as session expiry', async () => {
    const onUnauthorized = vi.fn()
    const client = createSkillsClient(
      options({
        onUnauthorized,
        fetch: vi.fn(async () => {
          throw new Error('Offline')
        }),
      }),
    )
    await expect(client.listSkills()).rejects.toThrow(Error)
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it.each([200, 401])(
    'discards a late %s after invalidation, even if fetch ignores abort',
    async (status) => {
      const delayed = delayedTransport()
      const onUnauthorized = vi.fn()
      const client = createSkillsClient(
        options({ fetch: delayed.fetch, onUnauthorized }),
      )
      const pending = client.listSkills()
      const rejection = expect(pending).rejects.toThrow(Error)
      await delayed.started
      client.invalidate()
      delayed.respond(
        status === 200
          ? Response.json([skill()])
          : Response.json(
              {
                _tag: 'SkillUnauthorizedError',
                message: 'Expired old session',
              },
              { status },
            ),
      )
      await rejection
      expect(onUnauthorized).not.toHaveBeenCalled()
      await expect(client.listSkills()).rejects.toThrow(Error)
      expect(delayed.fetch).toHaveBeenCalledTimes(1)
    },
  )

  it('forwards cancellation to fetch and allows a later independent read', async () => {
    const delayed = delayedTransport()
    const controller = new AbortController()
    const client = createSkillsClient(options({ fetch: delayed.fetch }))
    const pending = client.listSkills(controller.signal)
    const rejected = expect(pending).rejects.toThrow(Error)
    await delayed.started
    controller.abort()
    await rejected
    expect(delayed.fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
    delayed.respond(Response.json([skill()]))
    delayed.fetch.mockResolvedValue(Response.json([skill()]))
    await expect(client.listSkills()).resolves.toEqual([skill()])
  })

  it('completes a real HTTP journey with host-supplied credentials and server refusal', async () => {
    const server = createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json')
      if (req.url !== '/api/skills') {
        res.writeHead(404).end()
        return
      }
      if (req.headers.authorization !== 'Bearer fixture-member') {
        res.writeHead(401).end(
          JSON.stringify({
            _tag: 'SkillUnauthorizedError',
            message: 'Sign in',
          }),
        )
        return
      }
      if (req.headers['x-workspace-id'] !== 'workspace-a') {
        res.writeHead(403).end(
          JSON.stringify({
            _tag: 'SkillForbiddenError',
            message: 'Membership required',
          }),
        )
        return
      }
      res.end(JSON.stringify([skill()]))
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string')
      throw new Error('Missing fixture port')
    const origin = `http://127.0.0.1:${address.port}`
    const authenticatedFetch: typeof fetch = (input, init) =>
      fetch(input, {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init?.headers)),
          Authorization: 'Bearer fixture-member',
        },
      })
    const result = await Promise.allSettled([
      createSkillsClient(
        options({ origin, fetch: authenticatedFetch }),
      ).listSkills(),
      createSkillsClient(
        options({
          origin,
          fetch: authenticatedFetch,
          workspaceId: 'workspace-b',
        }),
      ).listSkills(),
      createSkillsClient(options({ origin, fetch })).listSkills(),
    ])
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
    expect(result[0]).toEqual({ status: 'fulfilled', value: [skill()] })
    expect(result[1]?.status).toBe('rejected')
    expect(result[2]?.status).toBe('rejected')
  })
})
