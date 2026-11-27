// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { jsonSchema, tool, type ToolSet } from 'ai'
import type { ChatActionContext, ChatRequestContext } from '@cloudflare/think'
import { buildMcpAiToolKey } from '@garden/connectors/capabilities'
import { DEFAULT_TEAM_AGENT_POLICY } from '@garden/core/teams/agent-policy'
import * as schema from '@garden/db/schema'
import type * as runtimeDb from '@garden/db/runtime'
import { startTestDb, type TestDb } from '@garden/db/testing'
import {
  browserChatTags,
  type BrowserChatPrincipal,
} from '../../../../../../../packages/agent-runtime/src/browser-chat-authority'
import { authorizeChatRequestAction } from '../../../../../../../packages/agent-runtime/src/chat-request-authority'
import {
  RuntimeMcpController,
  type McpClientFacade,
  type McpHost,
} from '../../../../../../../packages/agent-runtime/src/runtime-mcp-controller'
import {
  TEST_DB_HOOK_TIMEOUT_MS,
  handlerFor,
  invocation,
  jsonRequest,
  makeContext,
  seedTeamRow,
  seedWorkspace,
  type FakeRole,
  type WorkspaceFixture,
} from '../../teams/-fixtures'
import { Route as ResolveRoute } from '../../permission-requests/$id/resolve'
import { Route as ToolApprovalRoute } from './$id/tool-approval'

const dbFactory = vi.hoisted(() => ({
  getPooledDb: vi.fn<typeof runtimeDb.getPooledDb>(),
}))

// The runtime controller reads the suite database, so no pool outlives it.
vi.mock('@garden/db/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof runtimeDb>()),
  getPooledDb: dbFactory.getPooledDb,
}))

const CONNECTOR_ID = 'github'
const TOOL_ARGS = { body: 'approval authority probe' }

describe('connector approval from the runtime insert to the chat tool decision (integration)', () => {
  let testDb: TestDb

  beforeAll(async () => {
    testDb = await startTestDb()
    dbFactory.getPooledDb.mockImplementation(() => testDb.db)
  }, TEST_DB_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await testDb?.cleanup()
  })

  /** A chat thread whose agent must ask before one external connector write. */
  async function seed(input: {
    owner: (fixture: WorkspaceFixture) => string
    teamOwner?: (fixture: WorkspaceFixture) => string
  }) {
    const fixture = await seedWorkspace(testDb)
    const ownerUserId = input.owner(fixture)
    const runtimeName = `approval-${randomUUID()}`
    await testDb.db
      .update(schema.agent)
      .set({ hostName: runtimeName })
      .where(eq(schema.agent.id, fixture.activeAgentId))
    const threadId = randomUUID()
    await testDb.db.insert(schema.chatThread).values({
      id: threadId,
      runtimeKey: threadId,
      workspaceId: fixture.workspaceId,
      ownerUserId,
      agentId: fixture.activeAgentId,
      title: 'Approval authority',
    })
    const sessionId = randomUUID()
    await testDb.db.insert(schema.session).values({
      id: sessionId,
      token: randomUUID(),
      userId: ownerUserId,
      expiresAt: new Date(Date.now() + 600_000),
      activeOrganizationId: fixture.workspaceId,
    })
    const toolName = `approval_probe_${randomUUID().replaceAll('-', '')}`
    const capabilityId = randomUUID()
    await testDb.db.insert(schema.capability).values({
      id: capabilityId,
      connectorType: CONNECTOR_ID,
      name: toolName,
      riskClass: 'send_external',
    })
    await testDb.db.insert(schema.permissionGrant).values({
      id: randomUUID(),
      agentId: fixture.activeAgentId,
      capabilityId,
      trustLevel: 'ask',
      grantedBy: fixture.ownerId,
    })
    if (input.teamOwner) {
      const teamId = await seedTeamRow(testDb, {
        workspaceId: fixture.workspaceId,
        name: 'Technical',
        ownerUserId: input.teamOwner(fixture),
        memberUserIds: [ownerUserId],
      })
      await testDb.db.insert(schema.teamAgentPolicy).values({
        teamId,
        workspaceId: fixture.workspaceId,
        policy: {
          ...DEFAULT_TEAM_AGENT_POLICY,
          approval_required: ['send_external'],
        },
        updatedBy: fixture.adminId,
      })
    }
    const principal: BrowserChatPrincipal = {
      sessionId,
      userId: ownerUserId,
      workspaceId: fixture.workspaceId,
      agentId: fixture.activeAgentId,
      threadId,
      runtimeKey: threadId,
      runtimeName,
    }
    const rootId = randomUUID()
    const request: ChatRequestContext = {
      version: 1,
      requestId: rootId,
      rootRequestId: rootId,
      source: {
        kind: 'connection',
        connectionId: randomUUID(),
        connectionTags: browserChatTags(principal),
      },
    }
    const decide = (changes: Partial<ChatActionContext>) =>
      authorizeChatRequestAction(testDb.db, threadId, {
        action: 'apply-tool-approval',
        request,
        ...changes,
      })
    return { fixture, principal, request, toolName, threadId, decide }
  }

  /**
   * Asks the production approval gate of the chat runtime. The host has no
   * identity override, so the controller resolves the thread as the chat facet
   * does and writes the request row itself.
   */
  async function requestApproval(
    seeded: Awaited<ReturnType<typeof seed>>,
    toolCallId: string,
  ) {
    // The approval gate reads the database only; the platform leaves stay unused.
    const mcp: Pick<
      McpClientFacade,
      'getAITools' | 'listTools' | 'listServers' | 'discoverIfConnected'
    > = {
      getAITools: () => ({}),
      listTools: () => [
        { name: seeded.toolName, serverId: CONNECTOR_ID, inputSchema: {} },
      ],
      listServers: () => [{ id: CONNECTOR_ID }],
      discoverIfConnected: async () => ({ success: true }),
    }
    const threadName: string = seeded.threadId
    const host = {
      name: threadName,
      env: { HYPERDRIVE: { connectionString: testDb.databaseUrl } },
      ctx: { storage: { sql: {} } },
      mcp,
      removeMcpServer: async (_connectorId: string) => {},
    } as McpHost
    const key = buildMcpAiToolKey(CONNECTOR_ID, seeded.toolName)
    const probe: ToolSet = {
      [key]: tool({
        description: 'probe',
        inputSchema: jsonSchema({ type: 'object' }),
      }),
    }
    const wrapped = new RuntimeMcpController(host).wrapGetAITools(
      () => probe,
      undefined,
    )
    const gate = wrapped[key]?.needsApproval
    if (typeof gate !== 'function')
      throw new Error('The runtime added no approval gate')
    expect(await gate(TOOL_ARGS, { toolCallId, messages: [] })).toBe(true)
    const rows = await testDb.db
      .select()
      .from(schema.permissionRequest)
      .where(
        and(
          eq(schema.permissionRequest.toolCallId, toolCallId),
          eq(schema.permissionRequest.threadId, seeded.threadId),
        ),
      )
    expect(rows).toHaveLength(1)
    const row = rows[0]
    if (!row) throw new Error('The runtime wrote no permission request')
    return row
  }

  function resolveInChat(args: {
    seeded: Awaited<ReturnType<typeof seed>>
    userId: string
    role: FakeRole
    toolCallId: string
    approved: boolean
  }) {
    const url = `https://garden.test/api/chat/threads/${args.seeded.threadId}/tool-approval`
    const request = jsonRequest(url, args.seeded.fixture.workspaceId, 'POST', {
      toolCallId: args.toolCallId,
      approved: args.approved,
    })
    return handlerFor(
      ToolApprovalRoute,
      'POST',
    )(
      invocation(
        makeContext({ testDb, userId: args.userId, role: args.role, request }),
        request,
        { id: args.seeded.threadId },
        url,
      ),
    )
  }

  function resolveInInbox(args: {
    seeded: Awaited<ReturnType<typeof seed>>
    userId: string
    role: FakeRole
    requestId: string
    approved: boolean
  }) {
    const url = `https://garden.test/api/permission-requests/${args.requestId}/resolve`
    const request = jsonRequest(url, args.seeded.fixture.workspaceId, 'POST', {
      approved: args.approved,
    })
    return handlerFor(
      ResolveRoute,
      'POST',
    )(
      invocation(
        makeContext({ testDb, userId: args.userId, role: args.role, request }),
        request,
        { id: args.requestId },
        url,
      ),
    )
  }

  async function expectApprovedEffect(
    seeded: Awaited<ReturnType<typeof seed>>,
    toolCallId: string,
  ) {
    expect(
      (await seeded.decide({ toolCallId, approved: true })).isOk(),
      'approval frame',
    ).toBe(true)
    expect(
      (
        await seeded.decide({
          action: 'execute-tool',
          toolCallId,
          approval: { approved: true, request: seeded.request },
        })
      ).isOk(),
      'tool effect',
    ).toBe(true)
    expect(
      (await seeded.decide({ toolCallId, approved: false })).isErr(),
      'opposite decision',
    ).toBe(true)
  }

  it('records the chat thread and admits the thread owner who approves as a workspace approver', async () => {
    const seeded = await seed({ owner: (fixture) => fixture.adminId })
    const toolCallId = `call-${randomUUID()}`
    const row = await requestApproval(seeded, toolCallId)
    expect(row).toMatchObject({
      threadId: seeded.threadId,
      agentId: seeded.fixture.activeAgentId,
      status: 'pending',
    })
    expect(
      (await seeded.decide({ toolCallId, approved: true })).isErr(),
      'a pending request admits no approval',
    ).toBe(true)
    const response = await resolveInChat({
      seeded,
      userId: seeded.fixture.adminId,
      role: 'admin',
      toolCallId,
      approved: true,
    })
    expect(response.status).toBe(200)
    await expectApprovedEffect(seeded, toolCallId)
  })

  it.each(['chat', 'inbox'] as const)(
    'limits %s approval to one thread when call IDs match',
    async (surface) => {
      const seeded = await seed({ owner: (fixture) => fixture.adminId })
      const otherThreadId = randomUUID()
      await testDb.db.insert(schema.chatThread).values({
        id: otherThreadId,
        runtimeKey: otherThreadId,
        workspaceId: seeded.fixture.workspaceId,
        agentId: seeded.fixture.activeAgentId,
        ownerUserId: seeded.fixture.adminId,
        title: 'Separate conversation',
      })
      const toolCallId = randomUUID()
      const other = { ...seeded, threadId: otherThreadId }
      const otherRow = await requestApproval(other, toolCallId)
      const ownRow = await requestApproval(seeded, toolCallId)
      const actor = {
        seeded,
        userId: seeded.fixture.adminId,
        role: 'admin' as const,
        approved: true,
      }
      const response =
        surface === 'chat'
          ? await resolveInChat({ ...actor, toolCallId })
          : await resolveInInbox({ ...actor, requestId: ownRow.id })
      expect(response.status).toBe(200)
      await expectApprovedEffect(seeded, toolCallId)
      const [stillPending] = await testDb.db
        .select()
        .from(schema.permissionRequest)
        .where(eq(schema.permissionRequest.id, otherRow.id))
      expect(stillPending?.status).toBe('pending')
      // The recent decision for identical tool arguments in the first thread
      // must not satisfy a later request in the second thread.
      await requestApproval(other, randomUUID())
    },
  )

  it('keeps the first recorded decision when two approvers decide concurrently', async () => {
    const seeded = await seed({ owner: (fixture) => fixture.adminId })
    const toolCallId = randomUUID()
    const row = await requestApproval(seeded, toolCallId)
    const results = await Promise.all(
      [true, false].map((approved) =>
        resolveInInbox({
          seeded,
          userId: seeded.fixture.adminId,
          role: 'admin',
          requestId: row.id,
          approved,
        }),
      ),
    )
    expect(results.filter((response) => response.status === 200)).toHaveLength(
      1,
    )
    const [decision] = await testDb.db
      .select()
      .from(schema.permissionRequest)
      .where(eq(schema.permissionRequest.id, row.id))
    expect(decision?.status).toBe(
      results[0]?.status === 200 ? 'approved' : 'denied',
    )
    const audits = await testDb.db
      .select()
      .from(schema.toolCallAudit)
      .where(eq(schema.toolCallAudit.toolCallId, toolCallId))
    expect(
      audits.filter(
        (audit) =>
          audit.resultStatus === 'approved' || audit.resultStatus === 'denied',
      ),
    ).toHaveLength(1)
  })

  it('admits a decision that another workspace approver made in the inbox', async () => {
    const seeded = await seed({ owner: (fixture) => fixture.memberId })
    const toolCallId = `call-${randomUUID()}`
    const row = await requestApproval(seeded, toolCallId)
    const refused = await resolveInChat({
      seeded,
      userId: seeded.fixture.memberId,
      role: 'member',
      toolCallId,
      approved: true,
    })
    expect(refused.status).toBe(403)
    expect(
      (await seeded.decide({ toolCallId, approved: true })).isErr(),
      'an unauthorized thread owner decides nothing',
    ).toBe(true)
    const response = await resolveInInbox({
      seeded,
      userId: seeded.fixture.ownerId,
      role: 'owner',
      requestId: row.id,
      approved: true,
    })
    expect(response.status).toBe(200)
    await expectApprovedEffect(seeded, toolCallId)
    // The resolver must still belong to the thread's workspace.
    await testDb.db
      .delete(schema.member)
      .where(
        and(
          eq(schema.member.userId, seeded.fixture.ownerId),
          eq(schema.member.organizationId, seeded.fixture.workspaceId),
        ),
      )
    expect((await seeded.decide({ toolCallId, approved: true })).isErr()).toBe(
      true,
    )
  })

  it('admits a decision of the Team owner whose policy held the call', async () => {
    const seeded = await seed({
      owner: (fixture) => fixture.memberId,
      teamOwner: (fixture) => fixture.otherId,
    })
    const toolCallId = `call-${randomUUID()}`
    const row = await requestApproval(seeded, toolCallId)
    expect(row.teamId).not.toBeNull()
    const response = await resolveInInbox({
      seeded,
      userId: seeded.fixture.otherId,
      role: 'member',
      requestId: row.id,
      approved: true,
    })
    expect(response.status).toBe(200)
    await expectApprovedEffect(seeded, toolCallId)
  })

  it('admits a recorded denial as a refusal only and never as an effect', async () => {
    const seeded = await seed({ owner: (fixture) => fixture.adminId })
    const toolCallId = `call-${randomUUID()}`
    await requestApproval(seeded, toolCallId)
    const response = await resolveInChat({
      seeded,
      userId: seeded.fixture.adminId,
      role: 'admin',
      toolCallId,
      approved: false,
    })
    expect(response.status).toBe(200)
    expect((await seeded.decide({ toolCallId, approved: false })).isOk()).toBe(
      true,
    )
    expect((await seeded.decide({ toolCallId, approved: true })).isErr()).toBe(
      true,
    )
    for (const approved of [true, false])
      expect(
        (
          await seeded.decide({
            action: 'execute-tool',
            toolCallId,
            approval: { approved, request: seeded.request },
          })
        ).isErr(),
      ).toBe(true)
  })

  it('refuses a decision for a request that another thread raised', async () => {
    const seeded = await seed({ owner: (fixture) => fixture.adminId })
    const toolCallId = `call-${randomUUID()}`
    const row = await requestApproval(seeded, toolCallId)
    const otherThreadId = randomUUID()
    await testDb.db.insert(schema.chatThread).values({
      id: otherThreadId,
      runtimeKey: otherThreadId,
      workspaceId: seeded.fixture.workspaceId,
      ownerUserId: seeded.fixture.adminId,
      agentId: seeded.fixture.activeAgentId,
      title: 'Another thread',
    })
    await testDb.db
      .update(schema.permissionRequest)
      .set({ threadId: otherThreadId })
      .where(eq(schema.permissionRequest.id, row.id))
    const response = await resolveInInbox({
      seeded,
      userId: seeded.fixture.ownerId,
      role: 'owner',
      requestId: row.id,
      approved: true,
    })
    expect(response.status).toBe(200)
    expect((await seeded.decide({ toolCallId, approved: true })).isErr()).toBe(
      true,
    )
  })
})
