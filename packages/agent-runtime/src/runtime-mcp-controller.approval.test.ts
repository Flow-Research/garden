import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { jsonSchema, tool, type ToolSet } from 'ai'
import { eq } from 'drizzle-orm'
import * as schema from '@garden/db/schema'
import type * as runtimeDb from '@garden/db/runtime'
import { buildMcpAiToolKey } from '@garden/connectors/capabilities'
import { Result } from 'better-result'
import { startTestDb, type TestDb } from '@garden/db/testing'
import {
  RuntimeMcpController,
  type McpHost,
  type ThreadRuntimeIdentity,
} from './runtime-mcp-controller'

const dbFactory = vi.hoisted(() => ({
  getPooledDb: vi.fn<typeof runtimeDb.getPooledDb>(),
}))

/**
 * Reuses the real test DB client so runtime pools cannot outlive the container.
 * Separate pools raised 57P01 during teardown. Follows the test pattern in
 * packages/server/src/issues/list-issues.integration.test.ts.
 */
vi.mock('@garden/db/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof runtimeDb>()),
  getPooledDb: dbFactory.getPooledDb,
}))

const TOOL_ARGS = { body: 'probe comment' }
const TOOL_NAME = 'add_issue_comment'
const CONNECTOR_ID = 'github'

let testDb: TestDb

type Seeded = {
  ownerId: string
  workspaceId: string
  agentId: string
  capabilityId: string
}

async function seedBase(): Promise<Seeded> {
  const ownerId = randomUUID()
  const workspaceId = randomUUID()
  const agentId = randomUUID()
  const capabilityId = randomUUID()

  await testDb.db.insert(schema.user).values({
    id: ownerId,
    email: `${ownerId}@example.com`,
    name: 'Owner',
  })
  await testDb.db.insert(schema.organization).values({
    id: workspaceId,
    name: 'Approval workspace',
    slug: `approval-${workspaceId}`,
  })
  await testDb.db.insert(schema.member).values({
    organizationId: workspaceId,
    userId: ownerId,
    role: 'owner',
  })
  await testDb.db.insert(schema.agent).values({
    id: agentId,
    workspaceId,
    ownerUserId: ownerId,
    name: 'Garden',
    isDefault: true,
  })
  await testDb.db.insert(schema.capability).values({
    id: capabilityId,
    connectorType: CONNECTOR_ID,
    name: TOOL_NAME,
    riskClass: 'send_external',
  })
  await testDb.db.insert(schema.permissionGrant).values({
    id: randomUUID(),
    agentId,
    capabilityId,
    trustLevel: 'ask',
    grantedBy: ownerId,
  })

  return { ownerId, workspaceId, agentId, capabilityId }
}

function makeController(
  seeded: Seeded,
  agentId: string = seeded.agentId,
  runId?: string,
  toolName: string = TOOL_NAME,
  serverId: string = CONNECTOR_ID,
  hasMember = true,
) {
  const memberUserId = randomUUID()
  const identity: ThreadRuntimeIdentity = {
    threadId: randomUUID(),
    workspaceId: seeded.workspaceId,
    userId: memberUserId,
    connectorUserId: hasMember ? memberUserId : null,
    agentId,
    runId,
  }

  const host = {
    name: 'approval-probe',
    env: {
      HYPERDRIVE: { connectionString: testDb.databaseUrl },
    },
    ctx: {
      storage: {
        sql: {},
      },
    },
    mcp: {
      getAITools: () => ({}) as ToolSet,
      listTools: () => [
        {
          name: toolName,
          serverId,
          description: 'Add a comment to a GitHub issue or pull request.',
          inputSchema: {},
        },
      ],
      listServers: () => [{ id: serverId }],
      discoverIfConnected: async () => ({ success: true }),
    },
    removeMcpServer: async () => {},
    resolveRuntimeIdentity: async () => Result.ok(identity),
  } as unknown as McpHost

  return new RuntimeMcpController(host)
}

async function needsApprovalForExecutor(
  controller: RuntimeMcpController,
  toolCallId: string,
  code: string,
): Promise<boolean> {
  const toolKey = buildMcpAiToolKey('executor', 'execute')
  const rawTools = {
    [toolKey]: tool({
      inputSchema: jsonSchema({ type: 'object', properties: {} }),
      execute: async () => ({}),
    }),
  } satisfies ToolSet
  const wrapped = controller.wrapGetAITools(() => rawTools)
  const needsApproval = wrapped[toolKey]?.needsApproval
  if (typeof needsApproval !== 'function') {
    throw new Error('Expected Executor approval gate')
  }
  return needsApproval({ code }, { toolCallId, messages: [] })
}

async function insertPermissionRequest(input: {
  seeded: Seeded
  agentId?: string
  toolCallId: string
  status: 'pending' | 'approved' | 'denied'
  runId?: string
}) {
  await testDb.db.insert(schema.permissionRequest).values({
    id: randomUUID(),
    agentId: input.agentId ?? input.seeded.agentId,
    kind: 'connector_write',
    capabilityId: input.seeded.capabilityId,
    argsJson: TOOL_ARGS,
    toolCallId: input.toolCallId,
    status: input.status,
    resolvedAt: input.status === 'pending' ? null : new Date(),
    runId: input.runId ?? null,
  })
}

async function needsApprovalFor(
  controller: RuntimeMcpController,
  toolCallId: string,
  toolName: string = TOOL_NAME,
): Promise<boolean> {
  const rawToolKey = buildMcpAiToolKey(CONNECTOR_ID, toolName)
  const rawTools = {
    [rawToolKey]: {
      name: toolName,
      description: 'probe tool',
      inputSchema: {},
    },
  } as unknown as ToolSet

  const wrapped = controller.wrapGetAITools(() => rawTools, undefined)
  const wrappedKey = buildMcpAiToolKey(CONNECTOR_ID, toolName)
  const tool = wrapped[wrappedKey] as unknown as {
    needsApproval?: (
      input: unknown,
      options: { toolCallId: string; messages: unknown[] },
    ) => Promise<boolean>
  }

  expect(tool?.needsApproval).toBeDefined()

  return await tool.needsApproval!(TOOL_ARGS, {
    toolCallId,
    messages: [],
  })
}

describe('connector tool approval gate (integration)', () => {
  let seeded: Seeded
  let controller: RuntimeMcpController

  /** Uses @garden/db/testing so missing Postgres fails setup instead of skipping checks. */
  beforeAll(async () => {
    testDb = await startTestDb()
    dbFactory.getPooledDb.mockImplementation((connectionString) => {
      if (connectionString !== testDb.databaseUrl) {
        throw new Error('Expected the suite-owned database connection')
      }
      return testDb.db
    })
    seeded = await seedBase()
    controller = makeController(seeded)
  })

  afterAll(async () => {
    await testDb?.cleanup()
  })

  it('blocks while the permission request is pending', async () => {
    const toolCallId = `pending-${randomUUID()}`
    await insertPermissionRequest({
      seeded,
      toolCallId,
      status: 'pending',
    })

    await expect(needsApprovalFor(controller, toolCallId)).resolves.toBe(true)
  })

  it('proceeds once the same call has been approved', async () => {
    const toolCallId = `approved-${randomUUID()}`
    await insertPermissionRequest({
      seeded,
      toolCallId,
      status: 'approved',
    })

    await expect(needsApprovalFor(controller, toolCallId)).resolves.toBe(false)
  })

  it('fails a denied call instead of executing it', async () => {
    const toolCallId = `denied-${randomUUID()}`
    await insertPermissionRequest({
      seeded,
      toolCallId,
      status: 'denied',
    })

    await expect(needsApprovalFor(controller, toolCallId)).rejects.toThrow(
      /denied/i,
    )
  })

  it('does not reuse an approval from another run', async () => {
    const issueId = randomUUID()
    const firstRunId = randomUUID()
    const secondRunId = randomUUID()
    await testDb.db.insert(schema.issue).values({
      id: issueId,
      workspaceId: seeded.workspaceId,
      number: 1,
      title: 'Approval scope',
      createdBy: seeded.ownerId,
    })
    await testDb.db.insert(schema.issueRun).values([
      {
        id: firstRunId,
        workspaceId: seeded.workspaceId,
        issueId,
        agentId: seeded.agentId,
        hostName: seeded.agentId,
        status: 'waiting_for_approval',
        triggerSource: 'manual',
      },
      {
        id: secondRunId,
        workspaceId: seeded.workspaceId,
        issueId,
        agentId: seeded.agentId,
        hostName: seeded.agentId,
        status: 'waiting_for_approval',
        triggerSource: 'manual',
      },
    ])
    const approvalCallId = `approved-in-first-${randomUUID()}`
    await insertPermissionRequest({
      seeded,
      toolCallId: approvalCallId,
      status: 'approved',
      runId: firstRunId,
    })

    await expect(
      needsApprovalFor(
        makeController(seeded, seeded.agentId, firstRunId),
        `first-${randomUUID()}`,
      ),
    ).resolves.toBe(false)
    await expect(
      needsApprovalFor(
        makeController(seeded, seeded.agentId, secondRunId),
        `second-${randomUUID()}`,
      ),
    ).resolves.toBe(true)
    await expect(
      needsApprovalFor(
        makeController(seeded, seeded.agentId, secondRunId),
        approvalCallId,
      ),
    ).resolves.toBe(true)
  })

  it('denies a tool when its capability row is missing', async () => {
    const missingTool = `missing_${randomUUID().replaceAll('-', '')}`
    await expect(
      needsApprovalFor(
        makeController(seeded, seeded.agentId, undefined, missingTool),
        `missing-${randomUUID()}`,
        missingTool,
      ),
    ).rejects.toThrow(/Capability .* is unavailable/)
  })

  it('uses an org-only Executor capability without a personal connection', async () => {
    const capabilityId = randomUUID()
    await testDb.db.insert(schema.capability).values({
      id: capabilityId,
      connectorType: 'google-drive',
      name: 'list_files',
      riskClass: 'read',
    })
    await testDb.db.insert(schema.capability).values({
      id: randomUUID(),
      connectorType: 'google-drive',
      name: 'share_file',
      riskClass: 'send_external',
    })
    const executorController = makeController(
      seeded,
      seeded.agentId,
      undefined,
      'execute',
      'executor',
      false,
    )

    await expect(
      needsApprovalForExecutor(
        executorController,
        `org-${randomUUID()}`,
        'await tools.google_drive.org.company.list_files({})',
      ),
    ).resolves.toBe(false)
    await expect(
      needsApprovalForExecutor(
        executorController,
        `org-share-${randomUUID()}`,
        'await tools.google_drive.org.company.share_file({})',
      ),
    ).resolves.toBe(true)
    await expect(
      needsApprovalForExecutor(
        executorController,
        `unknown-${randomUUID()}`,
        'await tools.google_drive.org.company.unknown_tool({})',
      ),
    ).rejects.toThrow(/Capability .* is unavailable/)
  })

  describe('connection grant fallback', () => {
    let grantlessAgentId: string
    let grantlessController: RuntimeMcpController

    beforeAll(async () => {
      grantlessAgentId = randomUUID()
      await testDb.db.insert(schema.agent).values({
        id: grantlessAgentId,
        workspaceId: seeded.workspaceId,
        ownerUserId: seeded.ownerId,
        name: 'Grantless',
        isDefault: false,
      })
      grantlessController = makeController(seeded, grantlessAgentId)
    })

    it('uses the connection grant when no tool grant exists', async () => {
      await testDb.db.insert(schema.connectionGrant).values({
        id: randomUUID(),
        agentId: grantlessAgentId,
        connectorId: CONNECTOR_ID,
        trustLevel: 'allow',
        grantedBy: seeded.ownerId,
      })

      await expect(
        needsApprovalFor(grantlessController, `conn-${randomUUID()}`),
      ).resolves.toBe(false)
    })

    it('asks when the connection grant is ask', async () => {
      const agentId = randomUUID()
      await testDb.db.insert(schema.agent).values({
        id: agentId,
        workspaceId: seeded.workspaceId,
        ownerUserId: seeded.ownerId,
        name: 'Asker',
        isDefault: false,
      })
      await testDb.db.insert(schema.connectionGrant).values({
        id: randomUUID(),
        agentId,
        connectorId: CONNECTOR_ID,
        trustLevel: 'ask',
        grantedBy: seeded.ownerId,
      })
      const askController = makeController(seeded, agentId)
      try {
        await expect(
          needsApprovalFor(askController, `conn-${randomUUID()}`),
        ).resolves.toBe(true)
      } finally {
        await testDb.db
          .delete(schema.permissionRequest)
          .where(eq(schema.permissionRequest.agentId, agentId))
        await testDb.db
          .delete(schema.connectionGrant)
          .where(eq(schema.connectionGrant.agentId, agentId))
        await testDb.db.delete(schema.agent).where(eq(schema.agent.id, agentId))
      }
    })
  })
})
