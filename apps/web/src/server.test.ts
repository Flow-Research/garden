// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEnv } from '@/lib/server/env'

const harness = vi.hoisted(() => ({
  session: vi.fn(),
  getDb: vi.fn(),
  routeAgentRequest: vi.fn(),
  parentReads: vi.fn(),
  threadReads: vi.fn(),
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
vi.mock('@/lib/server/issue-run-reconciler', () => ({ reconcile: vi.fn() }))
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
