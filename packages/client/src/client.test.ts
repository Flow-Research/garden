import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import type { Result } from 'better-result'
import {
  createGardenClient,
  parseGardenOrigin,
  type ClientReadFailure,
} from './client'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((stop) => stop()))
})

/** Uses real HTTP and Fetch to prove scope headers and response decoding. */
async function fixture(
  handler: (
    path: string,
    headers: Record<string, string | string[] | undefined>,
    method?: string,
  ) => { status?: number; body: unknown },
) {
  const server = createServer((request, response) => {
    const result = handler(request.url ?? '/', request.headers, request.method)
    response.writeHead(result.status ?? 200, {
      'content-type': 'application/json',
    })
    response.end(JSON.stringify(result.body))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(
    () => new Promise<void>((resolve) => server.close(() => resolve())),
  )
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

function makeClient(
  origin: string,
  fetcher = globalThis.fetch,
  onAuthorityLost = () => {},
) {
  return createGardenClient({
    origin,
    fetch: fetcher,
    accountId: 'alice',
    workspaceId: 'a',
    sessionId: 'generation-1',
    createRequestId: () => 'request-1',
    onAuthorityLost,
  })
}

const task = {
  id: 'task',
  workspace_id: 'a',
  title: 'Required work',
  identifier: 'A-1',
  status: 'todo',
  updated_at: '2026-11-21T00:00:00Z',
}

function errorCode(result: Result<unknown, ClientReadFailure>) {
  return result.match({ ok: () => undefined, err: (error) => error.code })
}

describe('portable Garden read boundary', () => {
  it('uses current Garden routes and explicit workspace/request headers over HTTP', async () => {
    const origin = await fixture((path, headers) => {
      expect(path).toBe('/api/issues?workspace_id=a&limit=50')
      expect(headers['x-workspace-id']).toBe('a')
      expect(headers['x-request-id']).toBe('request-1')
      return { body: { issues: [task], total: 1 } }
    })
    const result = await makeClient(origin).listTasks()
    expect(result.isOk()).toBe(true)
    expect(result.unwrap().issues).toEqual([task])
  })

  it.each([401, 403])(
    'ends scope on HTTP %s and does not keep private data',
    async (status) => {
      let lost = 0
      const origin = await fixture(() => ({ status, body: {} }))
      const client = makeClient(origin, fetch, () => {
        lost += 1
      })
      expect((await client.listTasks()).isErr()).toBe(true)
      expect((await client.listTasks()).isErr()).toBe(true)
      expect(lost).toBe(1)
    },
  )

  it('refuses valid JSON from another workspace', async () => {
    const origin = await fixture(() => ({
      body: { issues: [{ ...task, workspace_id: 'b' }] },
    }))
    const result = await makeClient(origin).listTasks()
    expect(result.isErr()).toBe(true)
    expect(errorCode(result)).toBe('response')
  })

  it('refuses a run from another issue', async () => {
    const origin = await fixture(() => ({
      body: {
        run: {
          id: 'run',
          workspace_id: 'a',
          issue_id: 'other',
          status: 'running',
          cancel_requested_at: null,
          finished_at: null,
          updated_at: 'now',
        },
      },
    }))
    expect((await makeClient(origin).getActiveRun('task')).isErr()).toBe(true)
  })

  it('refuses foreign workspace chat threads and historical runs', async () => {
    const origin = await fixture((path) => ({
      body: path.startsWith('/api/chat/threads')
        ? [
            {
              id: 'private-thread',
              workspaceId: 'other-workspace',
              title: 'Private',
            },
          ]
        : [
            {
              id: 'run',
              workspace_id: 'other-workspace',
              issue_id: 'task',
              status: 'running',
              cancel_requested_at: null,
              finished_at: null,
              updated_at: 'now',
            },
          ],
    }))
    const client = makeClient(origin)
    expect((await client.listThreads()).isErr()).toBe(true)
    expect((await client.getRun('task', 'run')).isErr()).toBe(true)
  })

  it('encodes task identifiers instead of interpreting paths', async () => {
    const origin = await fixture((path) => {
      expect(path).toBe('/api/issues/task%2F..%2Fother/active-run')
      return { body: { run: null } }
    })
    expect(
      (await makeClient(origin).getActiveRun('task/../other')).isOk(),
    ).toBe(true)
  })

  it('ignores a late unauthorized response after invalidation', async () => {
    let finish!: (response: Response) => void
    let began!: () => void
    const started = new Promise<void>((resolve) => {
      began = resolve
    })
    let lost = 0
    const client = makeClient(
      'https://garden.example',
      () =>
        new Promise((resolve) => {
          finish = resolve
          began()
        }),
      () => {
        lost += 1
      },
    )
    const pending = client.listTasks()
    await started
    client.invalidate()
    finish(new Response(null, { status: 401 }))
    expect(errorCode(await pending)).toBe('session-ended')
    expect(lost).toBe(0)
  })

  it('refuses a response invalidated during JSON decoding', async () => {
    let finish!: (value: unknown) => void
    let began!: () => void
    const decoding = new Promise<void>((resolve) => {
      began = resolve
    })
    const response = new Response()
    response.json = () => {
      began()
      return new Promise((resolve) => {
        finish = resolve
      })
    }
    const client = makeClient('https://garden.example', async () => response)
    const pending = client.listTasks()
    await decoding
    client.invalidate()
    finish({ issues: [task] })
    expect(errorCode(await pending)).toBe('session-ended')
  })

  it('returns an explicit transport failure without invoking a mutation', async () => {
    const result = await makeClient('https://garden.example', async () =>
      Promise.reject(new Error('offline')),
    ).listTasks()
    expect(errorCode(result)).toBe('transport')
  })

  it('reads workspace membership and scoped thread projections through current routes', async () => {
    const origin = await fixture((path) => ({
      body:
        path === '/api/workspaces'
          ? [{ id: 'a', name: 'Workspace A', settings: {} }]
          : [
              {
                id: 'thread',
                workspaceId: 'a',
                title: 'Private chat',
                runtime_kind: 'chat',
              },
            ],
    }))
    const client = makeClient(origin)
    expect((await client.listWorkspaces()).unwrap()).toEqual([
      { id: 'a', name: 'Workspace A' },
    ])
    expect((await client.listThreads()).unwrap()).toEqual([
      { id: 'thread', workspaceId: 'a', title: 'Private chat' },
    ])
  })

  it('lists account workspaces without inventing a workspace and refuses scoped reads before selection', async () => {
    let requests = 0
    const origin = await fixture((path, headers) => {
      requests += 1
      expect(path).toBe('/api/workspaces')
      expect(headers['x-workspace-id']).toBeUndefined()
      return { body: [{ id: 'a', name: 'Workspace A' }] }
    })
    const client = createGardenClient({
      origin,
      fetch,
      accountId: 'alice',
      workspaceId: null,
      sessionId: 'new-session',
      createRequestId: () => 'request',
      onAuthorityLost: () => {},
    })
    expect((await client.listWorkspaces()).isOk()).toBe(true)
    expect(errorCode(await client.listTasks())).toBe('session-ended')
    expect(requests).toBe(1)
  })

  it('finds a historical run by exact ID and reports an absent run without switching', async () => {
    const row = {
      workspace_id: 'a',
      issue_id: 'task',
      status: 'succeeded',
      cancel_requested_at: null,
      finished_at: 'later',
      updated_at: 'later',
    }
    const origin = await fixture((path) => {
      expect(path).toBe('/api/issues/task/runs')
      return {
        body: [
          { ...row, id: 'new-run' },
          { ...row, id: 'original-run' },
        ],
      }
    })
    const client = makeClient(origin)
    expect((await client.getRun('task', 'original-run')).unwrap()?.id).toBe(
      'original-run',
    )
    expect((await client.getRun('task', 'missing')).unwrap()).toBeNull()
  })

  it('refuses a server error and invalid JSON as explicit response failures', async () => {
    const origin = await fixture(() => ({
      status: 500,
      body: { error: 'unavailable' },
    }))
    expect(errorCode(await makeClient(origin).listTasks())).toBe('response')
    const invalid = makeClient(
      'https://garden.example',
      async () => new Response('{', { status: 200 }),
    )
    expect(errorCode(await invalid.listTasks())).toBe('response')
  })

  it.each([
    'https://user:secret@example.com',
    'https://example.com/path',
    'https://example.com?x=1',
    'https://example.com#token',
    'http://192.168.1.2',
    'file:///tmp/file',
    'invalid',
  ])('refuses unsafe origin %s', (origin) => {
    expect(parseGardenOrigin(origin).isErr()).toBe(true)
  })

  it('creates an owned chat through the existing HTTP endpoint with a stable caller UUID', async () => {
    const id = '10000000-0000-4000-8000-000000000001'
    const target = {
      id,
      workspaceId: 'a',
      ownerUserId: 'alice',
      title: 'New Chat',
      hostName: 'host',
      runtime_key: id,
      runtime_kind: 'chat',
    }
    let payload: unknown
    const origin = await fixture((path, headers, method) => {
      expect(path).toBe('/api/chat/threads')
      expect(method).toBe('POST')
      expect(headers['x-workspace-id']).toBe('a')
      expect(headers['content-type']).toBe('application/json')
      return { status: 201, body: target }
    })
    const client = makeClient(origin, (input, init) => {
      payload = JSON.parse(String(init?.body))
      return fetch(input, init)
    })
    expect((await client.createChatThread(id)).unwrap()).toEqual(target)
    expect(payload).toEqual({ id })
  })

  it('refuses another owner and refuses invalid creation identities before HTTP', async () => {
    const id = '10000000-0000-4000-8000-000000000001'
    let calls = 0
    const origin = await fixture(() => {
      calls += 1
      return {
        body: [
          {
            id,
            workspaceId: 'a',
            ownerUserId: 'bob',
            title: 'Private',
            hostName: 'host',
            runtime_key: id,
            runtime_kind: 'chat',
          },
        ],
      }
    })
    const client = makeClient(origin)
    expect((await client.createChatThread('../unsafe')).isErr()).toBe(true)
    expect(calls).toBe(0)
    expect((await client.listChatTargets()).isErr()).toBe(true)
    expect(calls).toBe(1)
  })
})
