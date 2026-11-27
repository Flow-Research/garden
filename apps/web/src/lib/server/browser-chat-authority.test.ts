// @vitest-environment node
import { randomUUID } from 'node:crypto'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { eq } from 'drizzle-orm'
import { startTestDb, type TestDb } from '@garden/db/testing'
import * as schema from '@garden/db/schema'
import { createBetterAuth } from '@/lib/auth/instance'
import type { AppEnv } from './env'
import {
  browserChatPrincipalFromTags,
  browserChatTags,
} from '../../../../../packages/agent-runtime/src/browser-chat-authority'
import {
  admitBrowserChatFrame,
  admitBrowserChatRequest,
} from './browser-chat-authority'
import { AgentDO, stripBrowserAgentRoutingHeaders } from './browser-agent-do'
import { agentsSdk } from '@/test/agents-sdk-fixture'

vi.mock(
  'agents',
  async () => (await import('@/test/agents-sdk-fixture')).agentsSdk,
)

vi.mock('@garden/agent-runtime', async () => {
  const { agentsSdk: sdk } = await import('@/test/agents-sdk-fixture')
  const actual =
    await import('../../../../../packages/agent-runtime/src/browser-chat-authority')
  // Keep the actual SDK constructor, routing, acceptance and message dispatch.
  // Only Garden's model/sandbox runtime is replaced by this SDK-only leaf.
  class RuntimeAgentDO extends sdk.Agent {
    override async onBeforeSubAgent() {
      return undefined
    }
    override shouldSendProtocolMessages() {
      return false
    }
  }
  return { ...actual, AgentDO: RuntimeAgentDO }
})

const origin = 'https://garden.test'
const secret = 'browser-chat-authority-fixture-secret-over-32-characters'
let database: TestDb

beforeAll(async () => {
  database = await startTestDb()
}, 120_000)
afterEach(() => vi.unstubAllGlobals())
afterAll(async () => {
  await database?.cleanup()
})

async function fixture(runtimeNameInput?: string) {
  const auth = createBetterAuth(database.db, {
    BETTER_AUTH_SECRET: secret,
    BETTER_AUTH_URL: origin,
    RESEND_API_KEY: undefined,
    authMode: 'session',
  })
  const signup = await auth.api.signUpEmail({
    body: {
      name: 'Browser authority fixture',
      email: `${randomUUID()}@example.test`,
      password: 'fixture-password-9',
      rememberMe: false,
    },
    returnHeaders: true,
  })
  const cookie = signup.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ')
  const session = await auth.api.getSession({
    headers: new Headers({ cookie }),
    returnHeaders: true,
  })
  if (!session.response)
    throw new Error('Actual Better Auth fixture has no session')
  const fullCookie = [
    ...signup.headers.getSetCookie(),
    ...session.headers.getSetCookie(),
  ]
    .map((value) => value.split(';')[0])
    .join('; ')
  const userId = session.response.user.id
  const workspaceId = randomUUID()
  const agentId = randomUUID()
  const runtimeName = runtimeNameInput ?? `browser-${randomUUID()}`
  const threadId = randomUUID()
  const runtimeKey = randomUUID()
  await database.db.insert(schema.organization).values({
    id: workspaceId,
    name: 'Private workspace',
    slug: `browser-${workspaceId}`,
  })
  await database.db
    .insert(schema.member)
    .values({ organizationId: workspaceId, userId, role: 'owner' })
  await database.db.insert(schema.agent).values({
    id: agentId,
    workspaceId,
    ownerUserId: userId,
    name: 'Private agent',
    hostName: runtimeName,
  })
  await database.db.insert(schema.chatThread).values({
    id: threadId,
    workspaceId,
    ownerUserId: userId,
    agentId,
    runtimeKey,
    title: 'Private chat',
  })
  const env = {
    HYPERDRIVE: { connectionString: database.databaseUrl },
    BETTER_AUTH_SECRET: secret,
    BETTER_AUTH_URL: origin,
  } as Pick<AppEnv, 'HYPERDRIVE' | 'BETTER_AUTH_SECRET' | 'BETTER_AUTH_URL'>
  const request = () =>
    new Request(
      `${origin}/agents/agent-d-o/${runtimeName}/sub/chat-sub-agent/${runtimeKey}?_pk=garden.browser.nonchat.v1`,
      {
        headers: {
          cookie: fullCookie,
          origin,
          upgrade: 'websocket',
          'x-garden-user-id': randomUUID(),
          'x-garden-session-id': randomUUID(),
        },
      },
    )
  const admitted = await admitBrowserChatRequest(request(), env)
  expect(admitted.isOk()).toBe(true)
  return {
    auth,
    cookie: fullCookie,
    env,
    request,
    principal: admitted.unwrap(),
    userId,
    workspaceId,
    agentId,
    threadId,
    runtimeKey,
    runtimeName,
    sessionId: session.response.session.id,
  }
}

describe('fresh browser chat authority with actual Better Auth and PostgreSQL', () => {
  it('derives identity from the verified cookie and stores only bounded identifiers', async () => {
    const state = await fixture()
    expect(state.principal).toMatchObject({
      userId: state.userId,
      sessionId: state.sessionId,
      workspaceId: state.workspaceId,
    })
    const tags = browserChatTags(state.principal)
    expect(tags.length).toBeLessThanOrEqual(9)
    expect(tags.every((tag) => tag.length <= 256)).toBe(true)
    expect(browserChatPrincipalFromTags([...tags].reverse()).unwrap()).toEqual(
      state.principal,
    )
    expect(JSON.stringify(tags)).not.toContain(state.cookie)
    expect(
      (await admitBrowserChatFrame(state.principal, state.env)).isOk(),
    ).toBe(true)
  })

  it('does not revive a deleted session from its actual signed cookie cache', async () => {
    const state = await fixture()
    await database.db
      .delete(schema.session)
      .where(eq(schema.session.id, state.sessionId))
    expect(
      (
        await state.auth.api.getSession({
          headers: new Headers({ cookie: state.cookie }),
        })
      )?.user.id,
    ).toBe(state.userId)
    expect(
      (await admitBrowserChatRequest(state.request(), state.env)).isErr(),
    ).toBe(true)
    expect(
      (await admitBrowserChatFrame(state.principal, state.env)).isErr(),
    ).toBe(true)
  })

  it('refuses session expiry and membership removal on the next frame', async () => {
    const expired = await fixture()
    await database.db
      .update(schema.session)
      .set({ expiresAt: new Date(0) })
      .where(eq(schema.session.id, expired.sessionId))
    expect(
      (await admitBrowserChatFrame(expired.principal, expired.env)).isErr(),
    ).toBe(true)
    const removed = await fixture()
    await database.db
      .delete(schema.member)
      .where(eq(schema.member.userId, removed.userId))
    expect(
      (await admitBrowserChatFrame(removed.principal, removed.env)).isErr(),
    ).toBe(true)
  })

  it('refuses changed thread ownership, runtime and agent availability', async () => {
    const owned = await fixture()
    const other = await fixture()
    await database.db
      .update(schema.chatThread)
      .set({ ownerUserId: other.userId })
      .where(eq(schema.chatThread.id, owned.threadId))
    expect(
      (await admitBrowserChatFrame(owned.principal, owned.env)).isErr(),
    ).toBe(true)
    const runtime = await fixture()
    await database.db
      .update(schema.chatThread)
      .set({ runtimeKey: randomUUID() })
      .where(eq(schema.chatThread.id, runtime.threadId))
    expect(
      (await admitBrowserChatFrame(runtime.principal, runtime.env)).isErr(),
    ).toBe(true)
    const archived = await fixture()
    await database.db
      .update(schema.agent)
      .set({ status: 'archived' })
      .where(eq(schema.agent.id, archived.agentId))
    expect(
      (await admitBrowserChatFrame(archived.principal, archived.env)).isErr(),
    ).toBe(true)
  })

  it('refuses a changed named host and foreign scope instead of following a replacement', async () => {
    const state = await fixture()
    expect(
      (
        await admitBrowserChatFrame(
          { ...state.principal, workspaceId: randomUUID() },
          state.env,
        )
      ).isErr(),
    ).toBe(true)
    await database.db
      .update(schema.agent)
      .set({ hostName: `replacement-${randomUUID()}` })
      .where(eq(schema.agent.id, state.agentId))
    expect(
      (await admitBrowserChatFrame(state.principal, state.env)).isErr(),
    ).toBe(true)
  })

  it('refuses missing and foreign browser origins but accepts the exact native origin', async () => {
    const state = await fixture()
    for (const value of [
      null,
      'https://foreign.test',
      'garden-mobile://foreign',
    ]) {
      const request = state.request()
      if (value === null) request.headers.delete('origin')
      else request.headers.set('origin', value)
      expect((await admitBrowserChatRequest(request, state.env)).isErr()).toBe(
        true,
      )
    }
    const native = state.request()
    native.headers.set('origin', 'garden-mobile://')
    expect((await admitBrowserChatRequest(native, state.env)).isOk()).toBe(true)
  })

  it('returns a generic refusal when the database cannot be reached', async () => {
    const state = await fixture()
    const result = await admitBrowserChatFrame(state.principal, {
      HYPERDRIVE: {
        connectionString: 'postgres://private:private@127.0.0.1:1/private',
      } as Hyperdrive,
    })
    expect(result.isErr()).toBe(true)
    expect(
      result.match({ ok: () => '', err: (error) => error.message }),
    ).not.toContain('postgres')
  })
})

class PlatformSocket extends EventTarget {
  static OPEN = 1
  static READY_STATE_OPEN = 1
  readyState = 1
  binaryType = 'arraybuffer'
  sent: string[] = []
  attachment: unknown = null
  accept() {
    this.readyState = 1
  }
  close = vi.fn(() => {
    this.readyState = 3
  })
  send(value: string) {
    this.sent.push(value)
  }
  serializeAttachment(value: unknown) {
    this.attachment = structuredClone(value)
  }
  deserializeAttachment() {
    return structuredClone(this.attachment)
  }
}

function sdkRuntime(state: Awaited<ReturnType<typeof fixture>>) {
  vi.stubGlobal('WebSocket', PlatformSocket)
  const sockets: PlatformSocket[] = []
  const pairs: PlatformSocket[] = []
  const tags = new Map<PlatformSocket, string[]>()
  const sql = { exec: () => Object.assign([], { toArray: () => [] }) }
  const context = {
    id: { name: state.runtimeName },
    exports: { ChatSubAgent: class {} },
    storage: { sql, get: async () => undefined, put: async () => undefined },
    blockConcurrencyWhile: async (operation: () => Promise<unknown>) =>
      operation(),
    getWebSockets: (tag?: string) =>
      sockets.filter((socket) => !tag || tags.get(socket)?.includes(tag)),
    getTags: (socket: PlatformSocket) => tags.get(socket) ?? [],
    acceptWebSocket: (socket: PlatformSocket, values: string[]) => {
      sockets.push(socket)
      tags.set(socket, values)
    },
  }
  const parent = Reflect.construct(AgentDO, [
    context,
    state.env,
  ]) as InstanceType<typeof AgentDO>
  class ChatFixtureAgent extends agentsSdk.Agent {}
  const child = Reflect.construct(ChatFixtureAgent, [
    { ...context, id: { name: state.runtimeKey }, getWebSockets: () => [] },
    {},
  ]) as InstanceType<typeof agentsSdk.Agent>
  const forwarded = vi.spyOn(child, '_cf_handleSubAgentWebSocketMessage')
  const resolveChild = vi.fn(async () => child)
  Object.defineProperty(parent, '_cf_resolveSubAgent', { value: resolveChild })
  vi.stubGlobal(
    'WebSocketPair',
    class {
      0 = new PlatformSocket()
      1 = new PlatformSocket()
      constructor() {
        pairs.push(this[1])
      }
    },
  )
  const NodeResponse = globalThis.Response
  vi.stubGlobal(
    'Response',
    class extends NodeResponse {
      constructor(
        body?: BodyInit | null,
        init?: ResponseInit & { webSocket?: unknown },
      ) {
        super(body, init?.status === 101 ? { status: 200 } : init)
        if (init?.status === 101)
          Object.defineProperty(this, 'status', { value: 101 })
      }
    },
  )
  return { parent, child, forwarded, resolveChild, context, sockets, pairs }
}

describe('actual SDK cloned-request and hibernating frame dispatch', () => {
  it('retains server-derived tags across SDK cloning, state frames and an isolate restart, then refuses a revoked frame before child dispatch', async () => {
    const state = await fixture()
    const { parent, forwarded, context, sockets } = sdkRuntime(state)
    const response = await parent.fetch(state.request())
    expect(response.status).toBe(101)
    expect(sockets).toHaveLength(1)
    const socket = sockets[0]
    if (!socket) throw new Error('Actual SDK did not accept the socket')
    const principal = browserChatPrincipalFromTags(
      context.getTags(socket),
    ).unwrap()
    expect(principal).toEqual(state.principal)
    expect(context.getTags(socket)).not.toContain('garden.browser.nonchat.v1')
    const initialTags = [...context.getTags(socket)]
    await Reflect.apply(parent.webSocketMessage, parent, [
      socket,
      JSON.stringify({
        type: 'cf_agent_state',
        state: { sessionId: randomUUID(), userId: randomUUID() },
      }),
    ])
    expect(forwarded).toHaveBeenCalledOnce()
    expect(context.getTags(socket)).toEqual(initialTags)
    const restarted = Reflect.construct(AgentDO, [
      context,
      state.env,
    ]) as InstanceType<typeof AgentDO>
    Object.defineProperty(restarted, '_cf_resolveSubAgent', {
      value: async () => parent,
    })
    await database.db
      .delete(schema.session)
      .where(eq(schema.session.id, state.sessionId))
    await Reflect.apply(restarted.webSocketMessage, restarted, [
      socket,
      JSON.stringify({
        type: 'cf_agent_use_chat_request',
        id: randomUUID(),
        init: { method: 'POST', body: JSON.stringify({ messages: [] }) },
      }),
    ])
    expect(forwarded).toHaveBeenCalledOnce()
    expect(socket.close).toHaveBeenCalledWith(
      1008,
      'Chat access is unavailable',
    )
  })

  it('requests a later retry when a running socket cannot verify access', async () => {
    const state = await fixture()
    const { parent, context, sockets } = sdkRuntime(state)
    await parent.fetch(state.request())
    const socket = sockets[0]
    if (!socket) throw new Error('Actual SDK did not accept the socket')
    const unavailable = Reflect.construct(AgentDO, [
      context,
      {
        ...state.env,
        HYPERDRIVE: { connectionString: 'postgres://test@127.0.0.1:1/test' },
      },
    ]) as InstanceType<typeof AgentDO>
    await Reflect.apply(unavailable.webSocketMessage, unavailable, [
      socket,
      'hello',
    ])
    expect(socket.close).toHaveBeenCalledWith(
      1013,
      'Chat access is unavailable',
    )
  })

  it('redacts a failed second admission before the SDK serializes its upgrade error', async () => {
    const state = await fixture()
    const proof = sdkRuntime(state)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(proof.parent, 'onBeforeSubAgent').mockImplementation(async () => {
      await database.db
        .delete(schema.session)
        .where(eq(schema.session.id, state.sessionId))
      return undefined
    })
    const response = await proof.parent.fetch(state.request())
    expect(response.status).toBe(101)
    expect(proof.sockets).toHaveLength(0)
    expect(proof.pairs.at(-1)?.sent.map((value) => JSON.parse(value))).toEqual([
      { error: 'Private chat access is unavailable. Reconnect.' },
    ])
    expect(JSON.stringify(proof.pairs.at(-1)?.sent)).not.toContain(state.cookie)
    const failure = errors.mock.calls
      .flat()
      .find((value) => value instanceof Error)
    expect(failure?.stack).toBe(
      'Private chat access is unavailable. Reconnect.',
    )
    errors.mockRestore()
  })

  it('requires a new handshake for an old socket without server-owned authority tags', async () => {
    const state = await fixture()
    const proof = sdkRuntime(state)
    const oldSocket = new PlatformSocket()
    await Reflect.apply(proof.parent.webSocketMessage, proof.parent, [
      oldSocket,
      'private payload must not be parsed',
    ])
    expect(proof.forwarded).not.toHaveBeenCalled()
    expect(oldSocket.close).toHaveBeenCalledWith(
      1008,
      'Reconnect to refresh chat access',
    )
  })

  it('redacts an oversized encoded scope before the SDK serializes its upgrade error', async () => {
    const state = await fixture('界'.repeat(256))
    expect(() => browserChatTags(state.principal)).toThrow('tag capacity')
    const proof = sdkRuntime(state)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await proof.parent.fetch(state.request())
    expect(response.status).toBe(101)
    expect(proof.sockets).toHaveLength(0)
    expect(proof.pairs.at(-1)?.sent.map((value) => JSON.parse(value))).toEqual([
      { error: 'Private chat access is unavailable. Reconnect.' },
    ])
    expect(
      errors.mock.calls.flat().find((value) => value instanceof Error)?.stack,
    ).toBe('Private chat access is unavailable. Reconnect.')
    errors.mockRestore()
  })

  it('does not let a nonchat connection select a private facet through headers, client IDs, state or frame fields', async () => {
    const state = await fixture()
    const proof = sdkRuntime(state)
    const privateUrl = state.request().url
    const forgedHeaders = {
      'x-cf-agents-subagent-url': privateUrl,
      'x-partykit-props': JSON.stringify({
        tags: browserChatTags(state.principal),
      }),
      'x-partykit-room': state.runtimeKey,
      'x-partykit-namespace': 'chat-sub-agent',
    }
    const root = stripBrowserAgentRoutingHeaders(
      new Request(
        `${origin}/agents/agent-d-o/${state.runtimeName}?_pk=garden.browser.chat.v1`,
        {
          headers: {
            cookie: state.cookie,
            origin,
            upgrade: 'websocket',
            ...forgedHeaders,
          },
        },
      ),
    )
    expect(root.headers.has('x-cf-agents-subagent-url')).toBe(false)
    expect((await proof.parent.fetch(root)).status).toBe(101)
    const socket = proof.sockets[0]
    if (!socket) throw new Error('Actual SDK did not accept the root socket')
    const initialTags = [...proof.context.getTags(socket)]
    expect(browserChatPrincipalFromTags(initialTags).isErr()).toBe(true)
    await database.db
      .delete(schema.session)
      .where(eq(schema.session.id, state.sessionId))
    for (const frame of [
      {
        type: 'cf_agent_state',
        state: {
          tags: browserChatTags(state.principal),
          uri: privateUrl,
          ...forgedHeaders,
        },
      },
      {
        type: 'rpc',
        id: randomUUID(),
        method: 'ensureThread',
        args: [state.runtimeKey],
        headers: forgedHeaders,
      },
      {
        type: 'cf_agent_use_chat_request',
        id: randomUUID(),
        target: privateUrl,
        headers: forgedHeaders,
        init: {
          method: 'POST',
          body: JSON.stringify({ messages: [], threadId: state.threadId }),
        },
      },
    ])
      await Reflect.apply(proof.parent.webSocketMessage, proof.parent, [
        socket,
        JSON.stringify(frame),
      ])
    expect(proof.resolveChild).not.toHaveBeenCalled()
    expect(proof.forwarded).not.toHaveBeenCalled()
    expect(proof.context.getTags(socket)).toEqual(initialTags)
  })
})
