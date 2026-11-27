// @vitest-environment node
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEnv } from '@/lib/server/env'
import type * as IssueRunReconciler from '@/lib/server/issue-run-reconciler'
import type * as ModelHealthCheck from '@/lib/server/model-health-check'
import { agentsSdk } from '@/test/agents-sdk-fixture'

const harness = vi.hoisted(() => ({
  session: vi.fn(),
  getDb: vi.fn(),
  routeAgentRequest: vi.fn(),
  parentReads: vi.fn(),
  threadReads: vi.fn(),
  reconcile: vi.fn(),
  modelHealthCheck: vi.fn(),
}))

vi.mock('@tanstack/react-start/server-entry', () => ({ default: {} }))
vi.mock('agents', async () => ({
  routeAgentRequest: harness.routeAgentRequest,
  parseSubAgentPath: (
    await import(
      new URL('./sub-routing.js', import.meta.resolve('agents')).href
    )
  ).parseSubAgentPath,
}))
vi.mock('@garden/agent-runtime', () => ({
  AgentDO: class AgentDO {},
  ChatSubAgent: class ChatSubAgent {},
  IssueRunSubAgent: class IssueRunSubAgent {},
  AutomationRunSubAgent: class AutomationRunSubAgent {},
  AutomationTriggerDO: class {},
  BrainAuditSubAgent: class {},
  BrainWriteBackSubAgent: class {},
  RunWorkflow: class {},
  WorkspaceRealtimeDO: class {},
}))
vi.mock('./decide-analysis-workflow', () => ({
  DecideAnalysisWorkflow: class {},
}))
vi.mock('./github-repo-import-workflow', () => ({
  GitHubRepoImportWorkflow: class {},
}))
vi.mock('@cloudflare/sandbox', () => ({
  proxyToSandbox: async () => null,
  Sandbox: class {},
}))
vi.mock('@/lib/auth', () => ({ createSessionAuth: vi.fn() }))
vi.mock('@/lib/server/env', () => ({ bindAppEnv: vi.fn() }))
vi.mock('@/lib/server/issue-run-reconciler', async (importOriginal) => ({
  ...(await importOriginal<typeof IssueRunReconciler>()),
  reconcile: harness.reconcile,
}))
vi.mock('@/lib/server/model-health-check', async (importOriginal) => ({
  ...(await importOriginal<typeof ModelHealthCheck>()),
  runModelHealthCheck: harness.modelHealthCheck,
}))
vi.mock('@/lib/server/context', () => ({
  createAppRequestContext: vi.fn(),
  getLoggedAuthSession: harness.session,
}))
vi.mock('@/lib/server/realtime', () => ({ handleRealtimeConnect: vi.fn() }))
vi.mock('@/lib/posthog-server', () => ({ capturePostHogException: vi.fn() }))
vi.mock('@/lib/server/executor-engine/mcp', () => ({
  ExecutorMcpExecutionOwnerDirectory: class {},
  ExecutorMcpSession: class {},
}))
vi.mock('@/lib/server/posthog-proxy', () => ({
  isPostHogProxyRequest: () => false,
  proxyPostHogRequest: vi.fn(),
}))
vi.mock('@/lib/server/db', async () => ({
  schema: await import('@garden/db/schema'),
  getDb: harness.getDb,
}))

const worker = (await import('./server')).default
const OWNER = '0c8b5c10-0000-4000-8000-000000000001'
const OTHER_MEMBER = '0c8b5c10-0000-4000-8000-000000000002'
const AGENT = '0c8b5c10-0000-4000-8000-000000000003'
const WORKSPACE = '0c8b5c10-0000-4000-8000-000000000004'
const THREAD = '0c8b5c10-0000-4000-8000-000000000005'
const RUNTIME = '0c8b5c10-0000-4000-8000-000000000006'
let hostCounter = 0
let hostName: string
let memberPresent: boolean
let thread: {
  id: string
  runtimeKey: string
  ownerUserId: string
  agentId: string
  workspaceId: string
} | null

function request(path: string, init?: RequestInit) {
  return worker.fetch(
    new Request(
      `https://garden.test/agents/agent-d-o/${hostName}${path}`,
      init,
    ),
    {} as AppEnv,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  hostName = `private-chat-guard-${++hostCounter}`
  memberPresent = true
  thread = {
    id: THREAD,
    runtimeKey: RUNTIME,
    ownerUserId: OWNER,
    agentId: AGENT,
    workspaceId: WORKSPACE,
  }
  harness.session.mockResolvedValue({ user: { id: OWNER } })
  harness.routeAgentRequest.mockImplementation(
    async () => new Response('routed'),
  )
  harness.getDb.mockResolvedValue({
    select: (selection: Record<string, unknown>) => {
      const query = {
        from: () => query,
        innerJoin: () => query,
        where: () => query,
        limit: async () => {
          if ('agent' in selection) {
            harness.parentReads()
            return memberPresent
              ? [
                  {
                    agent: {
                      id: AGENT,
                      workspaceId: WORKSPACE,
                      status: 'active',
                    },
                  },
                ]
              : []
          }
          harness.threadReads()
          return thread ? [{ thread }] : []
        },
      }
      return query
    },
  })
})

afterEach(() => vi.restoreAllMocks())

const internalHeaders = {
  'x-cf-agents-subagent-url': `https://garden.test/agents/agent-d-o/shared/sub/chat-sub-agent/${RUNTIME}`,
  'x-partykit-props': '{"untrusted":true}',
  'x-partykit-room': 'foreign-room',
  'x-partykit-namespace': 'foreign-namespace',
  'x-partykit-jurisdiction': 'foreign-jurisdiction',
}

function sdkHandshake() {
  class Parent extends agentsSdk.Agent {
    override shouldSendProtocolMessages() {
      return false
    }
  }
  const context = {
    id: { name: hostName },
    exports: { ChatSubAgent: class {} },
    storage: {
      sql: { exec: () => Object.assign([], { toArray: () => [] }) },
      get: async () => undefined,
    },
    getWebSockets: () => [],
  }
  const parent = Reflect.construct(Parent, [context, {}]) as InstanceType<
    typeof Parent
  >
  const guard = vi
    .spyOn(parent, 'onBeforeSubAgent')
    .mockResolvedValue(undefined)
  const forwarded = vi.fn(async () => undefined)
  const resolveChild = vi.fn(async () => ({
    _cf_handleSubAgentWebSocketConnect: forwarded,
  }))
  Object.defineProperty(parent, '_cf_resolveSubAgent', { value: resolveChild })
  const received: Request[] = []
  const platform = Object.getPrototypeOf(agentsSdk.Agent.prototype) as {
    fetch: (request: Request) => Promise<Response>
  }
  // The SDK still owns fetch routing, its guard, generated metadata and onConnect.
  // Replace only PartyServer's platform socket acceptance (Node has no 101 pair).
  vi.spyOn(platform, 'fetch').mockImplementation(async (incoming) => {
    received.push(incoming)
    if (incoming.headers.get('upgrade')?.toLowerCase() === 'websocket') {
      const connection = {
        id: 'handshake-proof',
        uri: incoming.url,
        tags: [],
        state: null as unknown,
        setState(value: unknown) {
          this.state = value
          return value
        },
        send: vi.fn(),
        close: vi.fn(),
      }
      await Reflect.apply(parent.onConnect, parent, [
        connection,
        { request: incoming },
      ])
    }
    return new Response('routed')
  })
  harness.routeAgentRequest.mockImplementation((incoming: Request) =>
    parent.fetch(incoming),
  )
  return { guard, forwarded, resolveChild, received }
}

describe('public SDK routing metadata boundary', () => {
  it.each(['GET', 'POST'])(
    'discards internal headers on ordinary %s while preserving cookie and body',
    async (method) => {
      const proof = sdkHandshake()
      const response = await request('', {
        method,
        body: method === 'POST' ? '{}' : undefined,
        headers: {
          ...internalHeaders,
          cookie: 'garden-test-session=present',
          'content-type': 'application/json',
        },
      })
      expect(response.status).toBe(200)
      const downstream = proof.received[0]
      expect(downstream).toBeDefined()
      for (const header of Object.keys(internalHeaders))
        expect(downstream?.headers.has(header)).toBe(false)
      expect(downstream?.headers.get('cookie')).toBe(
        'garden-test-session=present',
      )
      expect(downstream?.headers.get('content-type')).toBe('application/json')
      expect(await downstream?.text()).toBe(method === 'POST' ? '{}' : '')
      expect(proof.forwarded).not.toHaveBeenCalled()
    },
  )

  it('cannot select a foreign chat through a crafted parent WebSocket handshake', async () => {
    harness.session.mockResolvedValue({ user: { id: OTHER_MEMBER } })
    const proof = sdkHandshake()
    const response = await request('', {
      headers: {
        ...internalHeaders,
        Upgrade: 'websocket',
        cookie: 'garden-test-session=present',
      },
    })
    expect(response.status).toBe(200)
    expect(proof.forwarded).not.toHaveBeenCalled()
    expect(proof.resolveChild).not.toHaveBeenCalled()
    expect(proof.guard).not.toHaveBeenCalled()
    expect(proof.received[0]?.headers.get('upgrade')).toBe('websocket')
    expect(proof.received[0]?.headers.get('cookie')).toBe(
      'garden-test-session=present',
    )
    for (const header of Object.keys(internalHeaders))
      expect(proof.received[0]?.headers.has(header)).toBe(false)
  })

  it('retains metadata generated by the SDK after authorizing an owned facet', async () => {
    const proof = sdkHandshake()
    expect(
      (
        await request(`/sub/chat-sub-agent/${RUNTIME}`, {
          headers: {
            ...internalHeaders,
            'x-cf-agents-subagent-url': internalHeaders[
              'x-cf-agents-subagent-url'
            ].replace(RUNTIME, OTHER_MEMBER),
            Upgrade: 'websocket',
          },
        })
      ).status,
    ).toBe(200)
    expect(harness.threadReads).toHaveBeenCalledOnce()
    expect(proof.guard).toHaveBeenCalledOnce()
    expect(proof.resolveChild).toHaveBeenCalledWith('ChatSubAgent', RUNTIME)
    expect(proof.forwarded).toHaveBeenCalledOnce()
    expect(proof.received[0]?.headers.get('x-cf-agents-subagent-url')).toBe(
      `https://garden.test/agents/agent-d-o/${hostName}/sub/chat-sub-agent/${RUNTIME}`,
    )
    expect(proof.received[0]?.headers.get('x-partykit-props')).toBeNull()
  })
})

describe('private chat facet authorization at the Worker boundary', () => {
  it.each([THREAD, RUNTIME])(
    'allows the owner through thread id/runtime key %s',
    async (name) => {
      const response = await request(`/sub/chat-sub-agent/${name}/get-messages`)
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('routed')
      expect(harness.threadReads).toHaveBeenCalledOnce()
      expect(harness.routeAgentRequest).toHaveBeenCalledOnce()
    },
  )

  it.each(
    [THREAD, RUNTIME].flatMap((name) =>
      [
        { label: 'read', tail: '/get-messages', init: undefined },
        { label: 'send', tail: '', init: { method: 'POST', body: '{}' } },
        {
          label: 'connect',
          tail: '',
          init: { headers: { Upgrade: 'websocket' } },
        },
      ].map((operation) => ({ ...operation, name })),
    ),
  )(
    'refuses another same-workspace member trying to $label through $name',
    async ({ tail, init, name }) => {
      harness.session.mockResolvedValue({ user: { id: OTHER_MEMBER } })
      const response = await request(`/sub/chat-sub-agent/${name}${tail}`, init)
      expect(response.status).toBe(404)
      expect(harness.parentReads).toHaveBeenCalledOnce()
      expect(harness.routeAgentRequest).not.toHaveBeenCalled()
    },
  )

  it('checks the chat owner after a parent membership cache hit', async () => {
    harness.session.mockResolvedValue({ user: { id: OTHER_MEMBER } })
    expect((await request('')).status).toBe(200)
    harness.routeAgentRequest.mockClear()
    expect(
      (await request(`/sub/chat-sub-agent/${RUNTIME}/get-messages`)).status,
    ).toBe(404)
    expect(harness.parentReads).toHaveBeenCalledTimes(2)
    expect(harness.threadReads).toHaveBeenCalledOnce()
    expect(harness.routeAgentRequest).not.toHaveBeenCalled()
  })

  it.each(['agentId', 'workspaceId'] as const)(
    'rejects a thread bound to another %s',
    async (field) => {
      if (thread) thread[field] = OTHER_MEMBER
      expect(
        (await request(`/sub/chat-sub-agent/${RUNTIME}/get-messages`)).status,
      ).toBe(404)
      expect(harness.routeAgentRequest).not.toHaveBeenCalled()
    },
  )

  it('rejects an unknown thread', async () => {
    thread = null
    expect(
      (await request(`/sub/chat-sub-agent/${RUNTIME}/get-messages`)).status,
    ).toBe(404)
    expect(harness.routeAgentRequest).not.toHaveBeenCalled()
  })

  it('requires a session even when parent access was cached', async () => {
    expect((await request('')).status).toBe(200)
    harness.session.mockResolvedValue(null)
    harness.routeAgentRequest.mockClear()
    expect(
      (await request(`/sub/chat-sub-agent/${RUNTIME}/get-messages`)).status,
    ).toBe(401)
    expect(harness.threadReads).not.toHaveBeenCalled()
    expect(harness.routeAgentRequest).not.toHaveBeenCalled()
  })

  it('rechecks workspace membership for chat after warming the parent cache', async () => {
    expect((await request('')).status).toBe(200)
    memberPresent = false
    harness.routeAgentRequest.mockClear()
    expect(
      (await request(`/sub/chat-sub-agent/${RUNTIME}/get-messages`)).status,
    ).toBe(404)
    expect(harness.parentReads).toHaveBeenCalledTimes(2)
    expect(harness.routeAgentRequest).not.toHaveBeenCalled()
  })

  it('fails closed if the thread owner lookup fails', async () => {
    harness.threadReads.mockImplementationOnce(() => {
      throw new Error('database unavailable')
    })
    expect(
      (await request(`/sub/chat-sub-agent/${RUNTIME}/get-messages`)).status,
    ).toBe(404)
    expect(harness.routeAgentRequest).not.toHaveBeenCalled()
  })

  it.each([
    `/sub/unknown/wrapper/sub/chat-sub-agent/${RUNTIME}/get-messages`,
    `/sub/issue-run-sub-agent/${RUNTIME}/sub/chat-sub-agent/${RUNTIME}/get-messages`,
    `/sub/chat-sub-agent/%ZZ/get-messages`,
  ])(
    'refuses unsupported chat target %s before runtime dispatch',
    async (path) => {
      expect((await request(path)).status).toBe(404)
      expect(harness.routeAgentRequest).not.toHaveBeenCalled()
    },
  )

  it.each([
    '',
    `/sub/issue-run-sub-agent/${RUNTIME}`,
    `/sub/automation-run-sub-agent/${RUNTIME}`,
  ])('retains workspace-member access to nonchat route %s', async (path) => {
    harness.session.mockResolvedValue({ user: { id: OTHER_MEMBER } })
    expect((await request(path)).status).toBe(200)
    expect(harness.threadReads).not.toHaveBeenCalled()
    expect(harness.routeAgentRequest).toHaveBeenCalledOnce()
  })
})

const { ISSUE_RUN_RECONCILE_CRON } =
  await import('@/lib/server/issue-run-reconciler')
const { MODEL_HEALTH_CHECK_CRON } =
  await import('@/lib/server/model-health-check')

describe('scheduled', () => {
  async function fire(cron: string) {
    const pending: Promise<unknown>[] = []
    const ctx = {
      waitUntil: (promise: Promise<unknown>) => {
        pending.push(promise)
      },
    } as ExecutionContext
    await worker.scheduled(
      { cron, scheduledTime: Date.now(), noRetry: () => {} },
      {} as AppEnv,
      ctx,
    )
    await Promise.all(pending)
  }

  beforeEach(() => {
    harness.reconcile.mockResolvedValue({
      isErr: () => false,
    })
    harness.modelHealthCheck.mockResolvedValue({
      report: { status: 'healthy' },
      alert: 'not_needed',
    })
  })

  it('runs only the reconciler on its cron', async () => {
    await fire(ISSUE_RUN_RECONCILE_CRON)

    expect(harness.reconcile).toHaveBeenCalledOnce()
    expect(harness.modelHealthCheck).not.toHaveBeenCalled()
  })

  it('runs only the model health check on its cron', async () => {
    await fire(MODEL_HEALTH_CHECK_CRON)

    expect(harness.modelHealthCheck).toHaveBeenCalledOnce()
    expect(harness.reconcile).not.toHaveBeenCalled()
  })

  it('logs a job that throws instead of failing the invocation', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    harness.modelHealthCheck.mockRejectedValue(new Error('boom'))

    await expect(fire(MODEL_HEALTH_CHECK_CRON)).resolves.toBeUndefined()

    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'scheduled.job_failed',
        cron: MODEL_HEALTH_CHECK_CRON,
      }),
    )
  })

  it('runs no job for an unknown cron', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await fire('*/5 * * * *')

    expect(harness.reconcile).not.toHaveBeenCalled()
    expect(harness.modelHealthCheck).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'scheduled.unknown_cron' }),
    )
  })

  it('deploys exactly the crons that have jobs', () => {
    const jobs = [ISSUE_RUN_RECONCILE_CRON, MODEL_HEALTH_CHECK_CRON].sort()
    const wrangler = readFileSync(
      new URL('../wrangler.jsonc', import.meta.url),
      'utf8',
    )
    const alchemy = readFileSync(
      new URL('../../../alchemy.run.ts', import.meta.url),
      'utf8',
    )
    const crons = (source: string, pattern: RegExp) =>
      [...(pattern.exec(source)?.[1] ?? '').matchAll(/["']([^"']+)["']/g)]
        .map((match) => match[1])
        .sort()

    expect(crons(wrangler, /"crons":\s*\[([^\]]*)\]/)).toEqual(jobs)
    expect(crons(alchemy, /crons:\s*\[([^\]]*)\]/)).toEqual(jobs)
  })
})
