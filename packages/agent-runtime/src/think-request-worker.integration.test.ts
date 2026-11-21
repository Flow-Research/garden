import { randomUUID } from 'node:crypto'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import {
  createTestHarness,
  type TestHarness,
  type Unstable_RawConfig,
} from 'wrangler'
import { eq } from 'drizzle-orm'
import { startTestDb, type TestDb } from '@garden/db/testing'
import * as schema from '@garden/db/schema'
import type { BrowserChatPrincipal } from './browser-chat-authority'

let database: TestDb
let server: Server | undefined
let harness: TestHarness | undefined
let base: URL
const sockets = new Set<WebSocket>()
const modelCalls: Array<Record<string, unknown>> = []
const actions: Array<{
  action: string
  request: { requestId: string; source: { kind: string } }
  input?: unknown
}> = []
const effectInputs: unknown[] = []
const refusals: Array<{ action: string; message: string }> = []
let effects = 0
let holdPrepare = false
let heldPrepare: ServerResponse | undefined
let holdModel = false
let heldModel: ServerResponse | undefined
let toolResponse = false
let controlledToolName = 'fixture_effect'
let holdTool = false
let heldTool: ServerResponse | undefined

function complete(response: ServerResponse) {
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  const isTool = toolResponse
  toolResponse = false
  for (const chunk of isTool
    ? [
        {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: randomUUID(),
              type: 'function',
              function: { name: controlledToolName, arguments: '{}' },
            },
          ],
        },
        {},
      ]
    : [{ role: 'assistant', content: 'controlled result' }, {}]) {
    response.write(
      `data: ${JSON.stringify({ id: 'local-fixture', object: 'chat.completion.chunk', created: 0, model: 'fixture', choices: [{ index: 0, delta: chunk, finish_reason: Object.keys(chunk).length ? null : isTool ? 'tool_calls' : 'stop' }] })}\n\n`,
    )
  }
  response.end('data: [DONE]\n\n')
}

beforeAll(async () => {
  database = await startTestDb()
  server = createServer((request, response) => {
    void (async () => {
      const buffers: Buffer[] = []
      let bytes = 0
      for await (const chunk of request) {
        const buffer = Buffer.from(chunk)
        bytes += buffer.byteLength
        if (bytes > 1_048_576)
          throw new Error('Controlled fixture body exceeded its bound')
        buffers.push(buffer)
      }
      const body = Buffer.concat(buffers).toString('utf8')
      if (request.url === '/refusal') {
        refusals.push(JSON.parse(body))
        response.end('ok')
      } else if (request.url === '/effect') {
        effects++
        effectInputs.push(body ? JSON.parse(body) : null)
        response.end('ok')
      } else if (request.url === '/observe') {
        const action = JSON.parse(body)
        actions.push(action)
        if (holdPrepare && action.action === 'prepare-turn') {
          holdPrepare = false
          heldPrepare = response
        } else if (holdTool && action.action === 'execute-tool') {
          holdTool = false
          heldTool = response
        } else response.end('ok')
      } else if (request.url === '/v1/chat/completions') {
        const input = JSON.parse(body)
        modelCalls.push(input)
        if (input.stream !== true) {
          response.writeHead(200, { 'content-type': 'application/json' }).end(
            JSON.stringify({
              id: 'local-summary',
              object: 'chat.completion',
              created: 0,
              model: 'fixture',
              choices: [
                {
                  index: 0,
                  message: {
                    role: 'assistant',
                    content: 'controlled summary',
                  },
                  finish_reason: 'stop',
                },
              ],
              usage: {
                prompt_tokens: 1,
                completion_tokens: 1,
                total_tokens: 2,
              },
            }),
          )
          return
        }
        if (holdModel) {
          holdModel = false
          heldModel = response
        } else complete(response)
      } else response.writeHead(404).end()
    })().catch(() => response.writeHead(500).end('Controlled fixture failed'))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('Controlled fixture has no loopback address')
  const config: Unstable_RawConfig = {
    name: 'garden-chat-request-fixture',
    main: fileURLToPath(
      new URL('../fixtures/chat-request-worker.ts', import.meta.url),
    ),
    compatibility_date: '2026-04-18',
    compatibility_flags: ['nodejs_compat'],
    workers_dev: false,
    dev: { ip: '127.0.0.1' },
    durable_objects: {
      bindings: [
        { name: 'REQUEST_AGENT', class_name: 'RequestAgent' },
        { name: 'REQUEST_ROOT', class_name: 'RequestRoot' },
      ],
    },
    migrations: [
      { tag: 'fixture', new_sqlite_classes: ['RequestAgent', 'RequestRoot'] },
    ],
    hyperdrive: [
      {
        binding: 'HYPERDRIVE',
        id: '00000000000000000000000000000000',
        localConnectionString: database.databaseUrl,
      },
    ],
    vars: { FIXTURE_BASE_URL: `http://127.0.0.1:${address.port}` },
  }
  harness = createTestHarness({
    root: fileURLToPath(new URL('../../../', import.meta.url)),
    workers: [{ config }],
  })
  base = (await harness.listen()).url
}, 120_000)

beforeEach(() => {
  modelCalls.length = 0
  actions.length = 0
  effects = 0
  effectInputs.length = 0
  refusals.length = 0
  holdPrepare = false
  heldPrepare = undefined
  holdModel = false
  heldModel = undefined
  toolResponse = false
  controlledToolName = 'fixture_effect'
  holdTool = false
  heldTool = undefined
})
afterEach(async () => {
  heldPrepare?.end('released during cleanup')
  heldTool?.end('released during cleanup')
  if (heldModel && !heldModel.writableEnded) {
    if (heldModel.headersSent) heldModel.end()
    else complete(heldModel)
  }
  for (const socket of sockets) socket.close()
  sockets.clear()
})
afterAll(async () => {
  await harness?.close()
  await new Promise<void>((resolve, reject) => {
    if (!server) return resolve()
    server.close((error) => (error ? reject(error) : resolve()))
    server.closeAllConnections()
  })
  await database?.cleanup()
})

async function fixture(prefix = '') {
  const principal: BrowserChatPrincipal = {
    sessionId: randomUUID(),
    userId: randomUUID(),
    workspaceId: randomUUID(),
    agentId: randomUUID(),
    threadId: randomUUID(),
    runtimeKey: prefix
      ? `${prefix === 'step' ? 'feed0000' : prefix === 'rewrite' ? 'ba5e0000' : 'c0ffee00'}-${randomUUID().slice(9)}`
      : randomUUID(),
    runtimeName: '',
  }
  principal.runtimeName = principal.runtimeKey
  await database.db
    .insert(schema.user)
    .values({ id: principal.userId, email: `${principal.userId}@example.test` })
  await database.db.insert(schema.organization).values({
    id: principal.workspaceId,
    name: 'SDK request fixture',
    slug: principal.workspaceId,
  })
  await database.db.insert(schema.member).values({
    userId: principal.userId,
    organizationId: principal.workspaceId,
    role: 'owner',
  })
  await database.db.insert(schema.agent).values({
    id: principal.agentId,
    workspaceId: principal.workspaceId,
    ownerUserId: principal.userId,
    name: 'SDK request fixture',
    hostName: principal.runtimeName,
  })
  await database.db.insert(schema.chatThread).values({
    id: principal.threadId,
    runtimeKey: principal.runtimeKey,
    workspaceId: principal.workspaceId,
    agentId: principal.agentId,
    ownerUserId: principal.userId,
    title: 'SDK request fixture',
  })
  await database.db.insert(schema.session).values({
    id: principal.sessionId,
    token: randomUUID(),
    userId: principal.userId,
    expiresAt: new Date(Date.now() + 60_000),
  })
  return principal
}

async function socketFor(principal: BrowserChatPrincipal, facet = false) {
  const url = new URL(
    facet
      ? `/agents/request-root/${principal.runtimeKey}/sub/request-agent/${principal.runtimeKey}`
      : `/agents/request-agent/${principal.runtimeKey}`,
    base,
  )
  url.protocol = 'ws:'
  url.searchParams.set('fixture_session', principal.sessionId)
  const socket = new WebSocket(url)
  const received: Array<{
    type?: string
    id?: string
    done?: boolean
    error?: boolean | string
    body?: string
  }> = []
  socket.addEventListener('message', (message) =>
    received.push(JSON.parse(String(message.data))),
  )
  sockets.add(socket)
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true })
    socket.addEventListener(
      'error',
      () => reject(new Error('Actual Worker WebSocket failed')),
      { once: true },
    )
  })
  return { socket, received }
}

function send(
  socket: WebSocket,
  id = randomUUID(),
  extraBody: Record<string, unknown> = {},
) {
  socket.send(
    JSON.stringify({
      type: 'cf_agent_use_chat_request',
      id,
      init: {
        method: 'POST',
        body: JSON.stringify({
          ...extraBody,
          messages: [
            {
              id: `${id}:message`,
              role: 'user',
              parts: [{ type: 'text', text: 'controlled request' }],
            },
          ],
        }),
      },
    }),
  )
  return id
}

async function completed(
  received: Awaited<ReturnType<typeof socketFor>>['received'],
  id: string,
) {
  await vi.waitFor(
    () =>
      expect(received.some((entry) => entry.id === id && entry.done)).toBe(
        true,
      ),
    { timeout: 30_000, interval: 20 },
  )
}

function drive(
  principal: BrowserChatPrincipal,
  input: Record<string, unknown>,
) {
  if (!harness) throw new Error('Actual Worker harness is absent')
  return harness.fetch(`/fixture/${principal.runtimeKey}`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

describe('maintained Think dispatch, real SQLite and current PostgreSQL policy', () => {
  it('runs one actual browser request through captured scope and the model boundary', async () => {
    const principal = await fixture()
    const { socket, received } = await socketFor(principal)
    const id = send(socket)
    await completed(received, id)
    expect(modelCalls).toHaveLength(1)
    expect(effects).toBe(0)
    expect(
      actions.filter((value) => value.action === 'model-call'),
    ).toHaveLength(1)
    const context = actions.find(
      (value) => value.action === 'model-call',
    )?.request
    expect(context?.source.kind).toBe('connection')
    expect(context?.requestId).not.toBe(id)
  }, 60_000)

  it('refuses a session revoked during preparation before any model request', async () => {
    const principal = await fixture()
    const { socket, received } = await socketFor(principal)
    holdPrepare = true
    const id = send(socket)
    await vi.waitFor(() => expect(heldPrepare).toBeDefined(), {
      timeout: 30_000,
      interval: 20,
    })
    await database.db
      .delete(schema.session)
      .where(eq(schema.session.id, principal.sessionId))
    heldPrepare?.end('continue after actual database revocation')
    await completed(received, id)
    expect(modelCalls).toHaveLength(0)
    expect(effects).toBe(0)
    expect(received.some((entry) => entry.id === id && entry.error)).toBe(true)
  }, 60_000)

  it('rechecks a queued browser source and does not borrow the active turn authority', async () => {
    const principal = await fixture()
    const queuedSession = randomUUID()
    await database.db.insert(schema.session).values({
      id: queuedSession,
      token: randomUUID(),
      userId: principal.userId,
      expiresAt: new Date(Date.now() + 60_000),
    })
    const first = await socketFor(principal)
    const second = await socketFor({ ...principal, sessionId: queuedSession })
    holdModel = true
    const firstId = send(first.socket)
    await vi.waitFor(() => expect(heldModel).toBeDefined(), {
      timeout: 30_000,
      interval: 20,
    })
    const priorPersists = actions.filter(
      (entry) => entry.action === 'persist-messages',
    ).length
    const secondId = send(second.socket)
    await vi.waitFor(
      () =>
        expect(
          actions.filter((entry) => entry.action === 'persist-messages').length,
        ).toBeGreaterThan(priorPersists + 1),
      { timeout: 30_000, interval: 20 },
    )
    await database.db
      .delete(schema.session)
      .where(eq(schema.session.id, queuedSession))
    if (!heldModel) throw new Error('The controlled model request is not held')
    complete(heldModel)
    await completed(first.received, firstId)
    await completed(second.received, secondId)
    expect(modelCalls).toHaveLength(1)
    expect(effects).toBe(0)
    expect(
      second.received.some((entry) => entry.id === secondId && entry.error),
    ).toBe(true)
  }, 60_000)

  it('executes an actual controlled tool only under its captured current source', async () => {
    const principal = await fixture()
    const { socket, received } = await socketFor(principal)
    toolResponse = true
    const id = send(socket)
    await completed(received, id)
    expect(effects).toBe(1)
    expect(modelCalls).toHaveLength(2)
    const toolActions = actions.filter(
      (entry) => entry.action === 'execute-tool',
    )
    expect(toolActions.length).toBeGreaterThanOrEqual(2)
    expect(
      new Set(toolActions.map((entry) => entry.request.requestId)).size,
    ).toBe(1)
  }, 60_000)

  it('refuses an actual tool after its original session is revoked during admission', async () => {
    const principal = await fixture()
    const { socket, received } = await socketFor(principal)
    toolResponse = true
    holdTool = true
    const id = send(socket)
    await vi.waitFor(() => expect(heldTool).toBeDefined(), {
      timeout: 30_000,
      interval: 20,
    })
    await database.db
      .delete(schema.session)
      .where(eq(schema.session.id, principal.sessionId))
    heldTool?.end('continue after actual database revocation')
    await completed(received, id)
    expect(effects).toBe(0)
    expect(modelCalls).toHaveLength(1)
    expect(received.some((entry) => entry.id === id && entry.error)).toBe(true)
  }, 60_000)

  it('admits a native handoff only through its exact current browser principal', async () => {
    const principal = await fixture()
    const response = await drive(principal, {
      operation: 'save',
      applicationContext: { kind: 'browser-handoff', principal },
    })
    expect(response.ok).toBe(true)
    expect(modelCalls).toHaveLength(1)
    expect(
      actions.find((entry) => entry.action === 'model-call')?.request.source
        .kind,
    ).toBe('programmatic')
    expect(effects).toBe(0)
  }, 60_000)

  it('carries the request source into the actual automatic compaction model call', async () => {
    const principal = await fixture('compact-')
    const response = await drive(principal, {
      operation: 'save',
      count: 6,
      applicationContext: { kind: 'browser-handoff', principal },
    })
    expect(response.ok).toBe(true)
    expect(modelCalls.some((entry) => entry.stream !== true)).toBe(true)
    expect(modelCalls.some((entry) => entry.stream === true)).toBe(true)
    const calls = actions.filter((entry) => entry.action === 'model-call')
    expect(calls.length).toBe(modelCalls.length)
    expect(new Set(calls.map((entry) => entry.request.requestId)).size).toBe(1)
    expect(
      calls.every((entry) => entry.request.source.kind === 'programmatic'),
    ).toBe(true)
  }, 60_000)

  it('recovers an interrupted real SDK fiber using its original durable browser source', async () => {
    const principal = await fixture()
    const { socket } = await socketFor(principal)
    holdPrepare = true
    send(socket)
    await vi.waitFor(() => expect(heldPrepare).toBeDefined(), {
      timeout: 30_000,
      interval: 20,
    })
    const original = actions.find(
      (entry) => entry.action === 'prepare-turn',
    )?.request
    await drive(principal, { operation: 'interrupt' }).catch(() => undefined)
    heldPrepare?.end('old invocation ended')
    await drive(principal, { operation: 'inspect' })
    await vi.waitFor(() => expect(modelCalls).toHaveLength(1), {
      timeout: 40_000,
      interval: 20,
    })
    const recovered = actions.find(
      (entry) => entry.action === 'model-call',
    )?.request
    expect(recovered?.requestId).toBe(original?.requestId)
    expect(recovered?.source).toEqual(original?.source)
    expect(effects).toBe(0)
  }, 60_000)

  it('refuses a recovered real SDK fiber after its original browser session is revoked', async () => {
    const principal = await fixture()
    const { socket } = await socketFor(principal)
    holdPrepare = true
    send(socket)
    await vi.waitFor(() => expect(heldPrepare).toBeDefined(), {
      timeout: 30_000,
      interval: 20,
    })
    await database.db
      .delete(schema.session)
      .where(eq(schema.session.id, principal.sessionId))
    await drive(principal, { operation: 'interrupt' }).catch(() => undefined)
    heldPrepare?.end('old invocation ended')
    await drive(principal, { operation: 'inspect' })
    await vi.waitFor(
      async () => {
        const inspection = await drive(principal, { operation: 'inspect' })
        expect(await inspection.json()).toMatchObject({
          recovery: [{ status: 'exhausted', reason: 'recovery_error' }],
          messages: [{ role: 'user' }],
        })
      },
      { timeout: 40_000, interval: 50 },
    )
    expect(refusals).toContainEqual({
      action: 'prepare-turn',
      message: expect.stringContaining('Private chat access'),
    })
    expect(modelCalls).toHaveLength(0)
    expect(effects).toBe(0)
  }, 60_000)

  it('runs a server-owned Decide submission from its exact SDK row without a browser session', async () => {
    const principal = await fixture()
    const runId = randomUUID()
    await database.db.insert(schema.decideAnalysisRun).values({
      id: runId,
      workspaceId: principal.workspaceId,
      ownerUserId: principal.userId,
      ownerKind: 'chat',
      threadId: principal.threadId,
      agentId: principal.agentId,
      agentRuntimeName: principal.runtimeName,
      idempotencyKey: randomUUID(),
      workflowInstanceId: randomUUID(),
      question: 'Controlled result',
      status: 'completed',
      attempt: 2,
      completedAt: new Date(),
    })
    await database.db
      .delete(schema.session)
      .where(eq(schema.session.id, principal.sessionId))
    const submissionId = `decide-analysis:${runId}:attempt:2`
    const response = await drive(principal, {
      operation: 'submit',
      submissionId,
      metadata: {
        gardenChat: {
          kind: 'decide-result',
          runId,
          attempt: 2,
          threadId: principal.threadId,
        },
      },
    })
    expect(response.ok).toBe(true)
    await vi.waitFor(
      async () => {
        const inspection = await drive(principal, { operation: 'inspect' })
        expect(await inspection.json()).toMatchObject({
          submissions: [{ submissionId, status: 'completed' }],
        })
      },
      { timeout: 30_000, interval: 20 },
    )
    expect(modelCalls).toHaveLength(1)
    expect(
      actions.find((entry) => entry.action === 'model-call')?.request.source
        .kind,
    ).toBe('submission')
    expect(effects).toBe(0)
  }, 60_000)

  it('refuses browser request options before durable SDK mutation after session revocation', async () => {
    const principal = await fixture()
    const { socket, received } = await socketFor(principal)
    await database.db
      .delete(schema.session)
      .where(eq(schema.session.id, principal.sessionId))
    const id = send(socket, randomUUID(), {
      syntheticOption: 'must-not-persist',
      applicationContext: { kind: 'server' },
    })
    await completed(received, id)
    const inspection = await drive(principal, { operation: 'inspect' })
    expect(await inspection.json()).toMatchObject({
      messages: [],
      lastBody: [],
    })
    expect(modelCalls).toHaveLength(0)
    expect(effects).toBe(0)
    expect(received.some((entry) => entry.id === id && entry.error)).toBe(true)
  }, 60_000)

  it('continues a real pending browser tool result under its original request lineage', async () => {
    const principal = await fixture()
    const { socket, received } = await socketFor(principal)
    toolResponse = true
    controlledToolName = 'browser_effect'
    const id = send(socket, randomUUID(), {
      clientTools: [
        {
          name: 'browser_effect',
          parameters: { type: 'object', properties: {} },
        },
      ],
    })
    await completed(received, id)
    expect(modelCalls).toHaveLength(1)
    const inspection = await drive(principal, { operation: 'inspect' })
    const data = (await inspection.json()) as {
      messages: Array<{ parts: Array<{ type: string; toolCallId?: string }> }>
    }
    const pending = data.messages
      .flatMap((message) => message.parts)
      .find((part) => part.type === 'tool-browser_effect')
    expect(pending?.toolCallId).toBeDefined()
    socket.send(
      JSON.stringify({
        type: 'cf_agent_tool_result',
        toolCallId: pending?.toolCallId,
        toolName: 'browser_effect',
        output: 'controlled browser result',
        state: 'output-available',
        autoContinue: true,
      }),
    )
    await vi.waitFor(() => expect(modelCalls).toHaveLength(2), {
      timeout: 30_000,
      interval: 20,
    })
    expect(
      actions.filter((entry) => entry.action === 'apply-tool-result').length,
    ).toBeGreaterThanOrEqual(2)
    expect(effects).toBe(0)
  }, 60_000)

  it('keeps native save and submission methods outside the actual browser RPC allowlist', async () => {
    const principal = await fixture()
    const { socket, received } = await socketFor(principal)
    for (const method of ['nativeSave', 'saveMessages', 'submitMessages']) {
      const id = randomUUID()
      socket.send(
        JSON.stringify({
          type: 'rpc',
          id,
          method,
          args: [
            { applicationContext: { kind: 'browser-handoff', principal } },
          ],
        }),
      )
      await vi.waitFor(
        () =>
          expect(received.find((entry) => entry.id === id)).toMatchObject({
            type: 'rpc',
            error: `Method ${method} is not callable`,
          }),
        { timeout: 30_000, interval: 20 },
      )
    }
    expect(modelCalls).toHaveLength(0)
    expect(effects).toBe(0)
  }, 60_000)

  it('refuses unmapped browser execution approvals and rejections before runtime effects', async () => {
    const principal = await fixture()
    const { socket, received } = await socketFor(principal)
    for (const method of ['approveExecution', 'rejectExecution']) {
      const id = randomUUID()
      socket.send(
        JSON.stringify({
          type: 'rpc',
          id,
          method,
          args: ['unknown-execution'],
        }),
      )
      await vi.waitFor(
        () =>
          expect(received.find((entry) => entry.id === id)).toMatchObject({
            type: 'rpc',
            error: expect.stringContaining('Private chat access'),
          }),
        { timeout: 30_000, interval: 20 },
      )
    }
    expect(refusals.map((entry) => entry.action)).toEqual([
      'approve-execution',
      'reject-execution',
    ])
    expect(modelCalls).toHaveLength(0)
    expect(effects).toBe(0)
  }, 60_000)

  it('starts a fresh authenticated turn without laundering an older pending browser tool', async () => {
    const principal = await fixture()
    const first = await socketFor(principal)
    toolResponse = true
    controlledToolName = 'browser_effect'
    const originalId = send(first.socket, randomUUID(), {
      clientTools: [
        {
          name: 'browser_effect',
          parameters: { type: 'object', properties: {} },
        },
      ],
    })
    await completed(first.received, originalId)
    const inspection = await drive(principal, { operation: 'inspect' })
    const data = (await inspection.json()) as {
      messages: Array<{ parts: Array<{ type: string; toolCallId?: string }> }>
    }
    const pending = data.messages
      .flatMap((message) => message.parts)
      .find((part) => part.type === 'tool-browser_effect')
    expect(pending?.toolCallId).toBeDefined()
    const nextSession = randomUUID()
    await database.db.insert(schema.session).values({
      id: nextSession,
      token: randomUUID(),
      userId: principal.userId,
      expiresAt: new Date(Date.now() + 60_000),
    })
    const current = await socketFor({ ...principal, sessionId: nextSession })
    await database.db
      .delete(schema.session)
      .where(eq(schema.session.id, principal.sessionId))
    const freshId = send(current.socket)
    await completed(current.received, freshId)
    expect(modelCalls).toHaveLength(2)
    current.socket.send(
      JSON.stringify({
        type: 'cf_agent_tool_result',
        toolCallId: pending?.toolCallId,
        toolName: 'browser_effect',
        output: 'must not adopt',
        state: 'output-available',
        autoContinue: true,
      }),
    )
    await vi.waitFor(
      () =>
        expect(refusals).toContainEqual({
          action: 'apply-tool-result',
          message: expect.stringContaining('Private chat access'),
        }),
      { timeout: 30_000, interval: 20 },
    )
    expect(modelCalls).toHaveLength(2)
    expect(effects).toBe(0)
  }, 60_000)

  it('refuses source-index overflow and clears retained references with SDK history', async () => {
    const principal = await fixture()
    const applicationContext = { kind: 'browser-handoff', principal }
    await expect(
      drive(principal, { operation: 'fill', applicationContext }),
    ).rejects.toThrow('Chat source storage is full')
    const inspection = await drive(principal, { operation: 'inspect' })
    expect(await inspection.json()).toMatchObject({ sourceRecords: 4096 })
    expect(modelCalls).toHaveLength(0)
    const cleared = await drive(principal, { operation: 'clear' })
    expect(await cleared.json()).toMatchObject({
      sourceRecords: 0,
      messages: [],
    })
    const fresh = await drive(principal, {
      operation: 'save',
      applicationContext,
    })
    expect(await fresh.json()).toMatchObject({ status: 'completed' })
    expect(modelCalls).toHaveLength(1)
    expect(effects).toBe(0)
  }, 60_000)

  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])(
    'rechecks each actual model retry with revoked=%s and step override=%s',
    async (revoked, stepOverride) => {
      const principal = await fixture(stepOverride ? 'step' : '')
      const { socket, received } = await socketFor(principal)
      holdModel = true
      const id = send(socket)
      await vi.waitFor(() => expect(heldModel).toBeDefined(), {
        timeout: 30_000,
        interval: 20,
      })
      if (revoked)
        await database.db
          .delete(schema.session)
          .where(eq(schema.session.id, principal.sessionId))
      heldModel?.writeHead(503, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          error: { message: 'Controlled retryable model response' },
        }),
      )
      await completed(received, id)
      expect(modelCalls).toHaveLength(revoked ? 1 : 2)
      const rejectedAttempts = refusals.filter(
        (entry) => entry.action === 'model-call',
      )
      expect(rejectedAttempts).toHaveLength(revoked ? 1 : 0)
      expect(
        rejectedAttempts.every((entry) =>
          entry.message.includes('Private chat access'),
        ),
      ).toBe(true)
      expect(
        actions.filter((entry) => entry.action === 'model-call'),
      ).toHaveLength(revoked ? 1 : 2)
      expect(effects).toBe(0)
    },
    60_000,
  )

  it('guards the actual native chat callback entry with explicit current authority', async () => {
    const principal = await fixture()
    const response = await drive(principal, {
      operation: 'chat',
      applicationContext: { kind: 'browser-handoff', principal },
    })
    expect(await response.json()).toMatchObject({ events: expect.any(Number) })
    expect(modelCalls).toHaveLength(1)
    expect(effects).toBe(0)
    expect(
      actions.find((entry) => entry.action === 'model-call')?.request.source
        .kind,
    ).toBe('programmatic')
  }, 60_000)

  it('refuses complete client tool dispatch after revocation during the model stream', async () => {
    const principal = await fixture()
    const { socket, received } = await socketFor(principal)
    toolResponse = true
    controlledToolName = 'browser_effect'
    holdModel = true
    const id = send(socket, randomUUID(), {
      clientTools: [
        {
          name: 'browser_effect',
          parameters: { type: 'object', properties: {} },
        },
      ],
    })
    await vi.waitFor(() => expect(heldModel).toBeDefined(), {
      timeout: 30_000,
      interval: 20,
    })
    await database.db
      .delete(schema.session)
      .where(eq(schema.session.id, principal.sessionId))
    if (!heldModel) throw new Error('Controlled model request is absent')
    complete(heldModel)
    await completed(received, id)
    expect(refusals).toContainEqual({
      action: 'dispatch-client-tool',
      message: expect.stringContaining('Private chat access'),
    })
    expect(
      received.some((entry) => entry.body?.includes('tool-input-available')),
    ).toBe(false)
    expect(modelCalls).toHaveLength(1)
    expect(effects).toBe(0)
  }, 60_000)

  it('retains actual server tags through the SDK facet WebSocket bridge', async () => {
    const principal = await fixture()
    const ready = await drive(principal, { operation: 'facet-inspect' })
    expect(ready.ok).toBe(true)
    const { socket, received } = await socketFor(principal, true)
    const id = send(socket)
    await completed(received, id)
    expect(modelCalls).toHaveLength(1)
    expect(
      actions.find((entry) => entry.action === 'model-call')?.request.source
        .kind,
    ).toBe('connection')
    expect(effects).toBe(0)
  }, 60_000)

  it.each([false, true])(
    'retains source through partial-stream recovery with revoked=%s',
    async (revoked) => {
      const principal = await fixture()
      const { socket, received } = await socketFor(principal)
      holdModel = true
      send(socket)
      await vi.waitFor(() => expect(heldModel).toBeDefined(), {
        timeout: 30_000,
        interval: 20,
      })
      if (!heldModel) throw new Error('Controlled model request is absent')
      heldModel.writeHead(200, { 'content-type': 'text/event-stream' })
      heldModel.write(
        `data: ${JSON.stringify({ id: 'local-partial', object: 'chat.completion.chunk', created: 0, model: 'fixture', choices: [{ index: 0, delta: { role: 'assistant', content: 'controlled partial' }, finish_reason: null }] })}\n\n`,
      )
      await vi.waitFor(
        () =>
          expect(
            received.some((entry) =>
              entry.body?.includes('controlled partial'),
            ),
          ).toBe(true),
        { timeout: 30_000, interval: 20 },
      )
      if (revoked)
        await database.db
          .delete(schema.session)
          .where(eq(schema.session.id, principal.sessionId))
      await drive(principal, { operation: 'interrupt' }).catch(() => undefined)
      heldModel.end()
      await drive(principal, { operation: 'inspect' })
      await vi.waitFor(
        () => {
          expect({
            calls: modelCalls.length,
            refused: refusals.some(
              (entry) =>
                entry.action === 'prepare-turn' &&
                entry.message.includes('Private chat access'),
            ),
          }).toEqual({ calls: revoked ? 1 : 2, refused: revoked })
        },
        { timeout: 30_000, interval: 20 },
      )
      const calls = actions.filter((entry) => entry.action === 'model-call')
      expect(calls).toHaveLength(revoked ? 1 : 2)
      expect(calls.map((entry) => entry.request)).toEqual(
        Array.from({ length: revoked ? 1 : 2 }, () => calls[0]?.request),
      )
      expect(effects).toBe(0)
    },
    60_000,
  )

  it('checks the exact rewritten tool input immediately before the actual effect', async () => {
    const principal = await fixture('rewrite')
    const { socket, received } = await socketFor(principal)
    toolResponse = true
    const id = send(socket)
    await completed(received, id)
    expect(effectInputs).toEqual([{ marker: 'rewritten' }])
    const checks = actions.filter((entry) => entry.action === 'execute-tool')
    expect(checks[0]?.input).toEqual({})
    expect(checks.at(-1)?.input).toEqual({ marker: 'rewritten' })
    expect(effects).toBe(1)
  }, 60_000)

  it('refuses unattributed native work before persisting a message', async () => {
    const principal = await fixture()
    await expect(drive(principal, { operation: 'save' })).rejects.toThrow(
      'Private chat access is unavailable.',
    )
    const inspection = await drive(principal, { operation: 'inspect' })
    expect(await inspection.json()).toMatchObject({ messages: [] })
    expect(modelCalls).toHaveLength(0)
    expect(effects).toBe(0)
  }, 60_000)
})
