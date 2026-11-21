import {
  Think,
  type ChatActionContext,
  type Session,
  type ToolCallResultContext,
} from '@cloudflare/think'
import {
  Agent,
  callable,
  getAgentByName,
  routeAgentRequest,
  type Connection,
  type ConnectionContext,
} from 'agents'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { tool } from 'ai'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { createRuntimeDbClient } from '@garden/db/runtime'
import * as schema from '@garden/db/schema'
import {
  browserChatTags,
  browserChatPrincipalFromTags,
  browserConnectionTag,
  checkBrowserChatPrincipal,
  resolveBrowserChatPrincipal,
} from '../src/browser-chat-authority'
import { authorizeChatRequestAction } from '../src/chat-request-authority'
import { configureThinkCompaction } from '../src/think-compaction'
import { getDefaultAgentModelProfile } from '../src/model'

/** Resolves synthetic initial admission or verifies the actual forwarded scope. */
async function fixtureConnectionTags(
  env: ChatRequestFixtureEnv,
  name: string,
  connection: Connection,
  context: ConnectionContext,
) {
  const client = await createRuntimeDbClient(env.HYPERDRIVE)
  const principal = await (async () => {
    if (connection.tags.includes(browserConnectionTag)) {
      const retained = browserChatPrincipalFromTags(connection.tags)
      if (retained.isErr()) throw retained.error
      if (retained.value.runtimeKey !== name)
        throw new Error('Forwarded fixture scope differs.')
      return checkBrowserChatPrincipal(client.db, retained.value)
    }
    // Production initial admission verifies a Better Auth cookie separately.
    const sessionId = new URL(context.request.url).searchParams.get(
      'fixture_session',
    )
    if (!sessionId) throw new Error('Synthetic fixture session is required.')
    const [session] = await client.db
      .select({ userId: schema.session.userId })
      .from(schema.session)
      .where(eq(schema.session.id, sessionId))
      .limit(1)
    if (!session) throw new Error('Synthetic fixture session is absent.')
    return resolveBrowserChatPrincipal(client.db, {
      sessionId,
      userId: session.userId,
      runtimeName: name,
      threadName: name,
    })
  })().finally(() => client.close())
  if (principal.isErr()) throw principal.error
  return browserChatTags(principal.value)
}

/** Uses the real SDK facet bridge without a replacement routing implementation. */
export class RequestRoot extends Agent<ChatRequestFixtureEnv> {
  override getConnectionTags(
    connection: Connection,
    context: ConnectionContext,
  ) {
    return fixtureConnectionTags(this.env, this.name, connection, context)
  }

  async inspectRequestFacet(name: string) {
    const child = await this.subAgent(RequestAgent, name)
    return child.inspectFixture()
  }
}

function fixtureModel(env: ChatRequestFixtureEnv) {
  return createOpenAICompatible({
    name: 'local-controlled-model',
    baseURL: `${env.FIXTURE_BASE_URL}/v1`,
  })('fixture')
}

function fixtureTools(env: ChatRequestFixtureEnv) {
  return {
    fixture_effect: tool({
      description: 'Records one controlled local effect.',
      inputSchema: z.object({ marker: z.string().optional() }),
      execute: async (input) => {
        const response = await fetch(`${env.FIXTURE_BASE_URL}/effect`, {
          method: 'POST',
          body: JSON.stringify(input),
        })
        if (!response.ok) throw new Error('Controlled tool port refused.')
        return 'one controlled effect'
      },
    }),
  }
}

function sourceRecordCount(sql: SqlStorage) {
  return sql
    .exec<{ total: number }>(
      "SELECT count(*) AS total FROM think_config WHERE key GLOB '__chat_source:*'",
    )
    .one().total
}

/**
 * A server-owned run turn on the maintained SDK. Like `RunSubAgentBase`, it has
 * no chat policy hook and no browser connection.
 */
export class RunTurnAgent extends Think<ChatRequestFixtureEnv> {
  override getModel() {
    return fixtureModel(this.env)
  }

  override getSystemPrompt() {
    return 'Return the controlled fixture response.'
  }

  override getTools() {
    return fixtureTools(this.env)
  }

  async runTurn() {
    const result = await this.saveMessages([
      {
        id: crypto.randomUUID(),
        role: 'user',
        parts: [{ type: 'text', text: 'fixture run turn' }],
      },
    ])
    return {
      status: result.status,
      sourceRecords: sourceRecordCount(this.ctx.storage.sql),
    }
  }
}

/** Runs the maintained SDK with real SQLite and current PostgreSQL authority. */
export class RequestAgent extends Think<ChatRequestFixtureEnv> {
  override chatRecovery = true
  private fillSourceIndex = false

  interruptFixture() {
    this.ctx.abort('Controlled fixture restart.')
  }
  override getModel() {
    return fixtureModel(this.env)
  }

  override configureSession(session: Session) {
    if (!this.name.startsWith('c0ffee00-')) return session
    const profile = getDefaultAgentModelProfile()
    return configureThinkCompaction(
      session,
      this.getModel(),
      {
        ...profile,
        compaction: {
          ...profile.compaction,
          thresholdTokens: 1,
          tailTokenBudgetTokens: 0,
        },
      },
      { beforeModelCall: () => this.admitCurrentChatAction('model-call') },
    )
  }

  override beforeStep() {
    return this.name.startsWith('feed0000-')
      ? { model: this.getModel() }
      : undefined
  }

  override beforeToolCall() {
    return this.name.startsWith('ba5e0000-')
      ? { action: 'allow' as const, input: { marker: 'rewritten' } }
      : undefined
  }

  override getSystemPrompt() {
    return 'Return the controlled fixture response.'
  }

  override getTools() {
    return fixtureTools(this.env)
  }

  /** Retains the tool's issued request for a proposal, as `propose_agent` does. */
  override afterToolCall(context: ToolCallResultContext) {
    const proposal = z
      .object({ marker: z.uuid() })
      .safeParse(context.success ? context.input : undefined)
    if (proposal.success)
      this.retainChatRequestReference(
        `garden-proposal:${proposal.data.marker}`,
        context.request,
      )
  }

  /** Sends the production proposal continuation options over the calling socket. */
  @callable()
  async continueProposal(input: {
    approved: boolean
    permissionRequestId: string
    pendingAgentId: string
  }) {
    const reference = `garden-proposal:${input.permissionRequestId}`
    const result = await this.saveMessages(
      [
        {
          id: crypto.randomUUID(),
          role: 'user',
          parts: [{ type: 'text', text: 'fixture proposal continuation' }],
        },
      ],
      {
        parentReference: reference,
        applicationContext: { kind: 'garden-approval', ...input },
      },
    )
    if (result.status === 'completed')
      this.releaseChatRequestReference(reference)
    return { status: result.status }
  }

  async nativeAdd() {
    await this.addMessages([
      {
        id: crypto.randomUUID(),
        role: 'assistant',
        parts: [{ type: 'text', text: 'fixture unattributed history' }],
      },
    ])
  }

  override async getConnectionTags(
    connection: Connection,
    context: ConnectionContext,
  ) {
    return fixtureConnectionTags(this.env, this.name, connection, context)
  }

  override async beforeChatAction(action: ChatActionContext) {
    const client = await createRuntimeDbClient(this.env.HYPERDRIVE)
    const result = await authorizeChatRequestAction(
      client.db,
      this.name,
      action,
    ).finally(() => client.close())
    if (result.isErr()) {
      await fetch(`${this.env.FIXTURE_BASE_URL}/refusal`, {
        method: 'POST',
        body: JSON.stringify({
          action: action.action,
          message: result.error.message,
        }),
      })
      throw result.error
    }
    if (this.fillSourceIndex && action.action === 'prepare-turn') {
      this.fillSourceIndex = false
      for (let index = 0; index <= 4096; index++)
        this.retainChatRequestReference(
          `fixture-record:${index}`,
          action.request,
        )
    }
    // This controlled observation port can hold an admitted hook for race tests.
    const observed = await fetch(`${this.env.FIXTURE_BASE_URL}/observe`, {
      method: 'POST',
      body: JSON.stringify(action),
    })
    if (!observed.ok) throw new Error('Controlled observation port refused.')
  }

  async nativeSave(applicationContext?: Record<string, unknown>, count = 1) {
    return this.saveMessages(
      Array.from({ length: count }, () => ({
        id: crypto.randomUUID(),
        role: 'user',
        parts: [{ type: 'text', text: 'fixture message' }],
      })),
      { applicationContext },
    )
  }

  async nativeSubmit(submissionId: string, metadata: Record<string, unknown>) {
    return this.submitMessages(
      [
        {
          id: `${submissionId}:message`,
          role: 'user',
          parts: [{ type: 'text', text: 'fixture submission' }],
        },
      ],
      { submissionId, idempotencyKey: submissionId, metadata },
    )
  }

  async fillReferences(applicationContext: Record<string, unknown>) {
    this.fillSourceIndex = true
    return this.nativeSave(applicationContext)
  }

  async clearFixtureHistory() {
    await this.clearMessages()
    return this.inspectFixture()
  }

  async nativeChat(applicationContext: Record<string, unknown>) {
    const events: string[] = []
    let error: string | undefined
    await this.chat(
      'controlled native callback request',
      {
        onStart: () => undefined,
        onEvent: (event) => {
          events.push(event)
        },
        onDone: () => undefined,
        onError: (message) => {
          error = message
        },
      },
      { applicationContext },
    )
    return { events: events.length, error }
  }

  async inspectFixture() {
    return {
      messages: await this.getMessages(),
      submissions: await this.listSubmissions(),
      recovery: [
        ...(
          await this.ctx.storage.list<{ status: string; reason?: string }>({
            prefix: 'cf:chat-recovery:incident:',
          })
        ).values(),
      ],
      sourceRecords: sourceRecordCount(this.ctx.storage.sql),
      lastBody: this.ctx.storage.sql
        .exec<{ value: string }>(
          "SELECT value FROM think_config WHERE key = 'lastBody'",
        )
        .toArray(),
    }
  }

  async refuseUnknownApproval(executionId: string) {
    return this.approveExecution(executionId)
  }
}

const driveSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('save'),
    count: z.number().int().min(1).max(8).optional(),
    applicationContext: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    operation: z.literal('submit'),
    submissionId: z.string(),
    metadata: z.record(z.string(), z.unknown()),
  }),
  z.object({ operation: z.literal('inspect') }),
  z.object({ operation: z.literal('facet-inspect') }),
  z.object({
    operation: z.literal('chat'),
    applicationContext: z.record(z.string(), z.unknown()),
  }),
  z.object({
    operation: z.literal('fill'),
    applicationContext: z.record(z.string(), z.unknown()),
  }),
  z.object({ operation: z.literal('clear') }),
  z.object({ operation: z.literal('add') }),
  z.object({ operation: z.literal('run-turn') }),
  z.object({ operation: z.literal('interrupt') }),
  z.object({ operation: z.literal('approve'), executionId: z.string() }),
])

export default {
  async fetch(request: Request, env: ChatRequestFixtureEnv) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/fixture/')) {
      const name = url.pathname.slice('/fixture/'.length)
      const input = driveSchema.parse(await request.json())
      const agent = await getAgentByName(env.REQUEST_AGENT, name)
      switch (input.operation) {
        case 'save':
          return Response.json(
            await agent.nativeSave(input.applicationContext, input.count),
          )
        case 'submit':
          return Response.json(
            await agent.nativeSubmit(input.submissionId, input.metadata),
          )
        case 'interrupt':
          await agent.interruptFixture()
          return new Response('interrupted')
        case 'fill':
          return Response.json(
            await agent.fillReferences(input.applicationContext),
          )
        case 'clear':
          return Response.json(await agent.clearFixtureHistory())
        case 'add':
          await agent.nativeAdd()
          return new Response('added')
        case 'run-turn':
          return Response.json(
            await (await getAgentByName(env.RUN_AGENT, name)).runTurn(),
          )
        case 'chat':
          return Response.json(await agent.nativeChat(input.applicationContext))
        case 'facet-inspect': {
          const root = await getAgentByName(env.REQUEST_ROOT, name)
          return Response.json(await root.inspectRequestFacet(name))
        }
        case 'inspect':
          return Response.json(await agent.inspectFixture())
        case 'approve':
          return Response.json(
            await agent.refuseUnknownApproval(input.executionId),
          )
      }
    }
    return (await routeAgentRequest(request, env)) ?? new Response('ready')
  },
} satisfies ExportedHandler<ChatRequestFixtureEnv>
