import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ToolSet } from 'ai'
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

function makeController(seeded: Seeded, agentId: string = seeded.agentId) {
  const identity: ThreadRuntimeIdentity = {
    threadId: randomUUID(),
    workspaceId: seeded.workspaceId,
    userId: randomUUID(),
    agentId,
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
          name: TOOL_NAME,
          serverId: CONNECTOR_ID,
          description: 'Add a comment to a GitHub issue or pull request.',
          inputSchema: {},
        },
      ],
      listServers: () => [{ id: CONNECTOR_ID }],
      discoverIfConnected: async () => ({ success: true }),
    },
    removeMcpServer: async () => {},
    resolveRuntimeIdentity: async () => Result.ok(identity),
  } as unknown as McpHost

  return new RuntimeMcpController(host)
}

async function insertPermissionRequest(input: {
  seeded: Seeded
  agentId?: string
  toolCallId: string
  status: 'pending' | 'approved' | 'denied'
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
  })
}

async function needsApprovalFor(
  controller: RuntimeMcpController,
  toolCallId: string,
): Promise<boolean> {
  const rawToolKey = buildMcpAiToolKey(CONNECTOR_ID, TOOL_NAME)
  const rawTools = {
    [rawToolKey]: {
      name: TOOL_NAME,
      description: 'probe tool',
      inputSchema: {},
    },
  } as unknown as ToolSet

  const wrapped = controller.wrapGetAITools(() => rawTools, undefined)
  const wrappedKey = buildMcpAiToolKey(CONNECTOR_ID, TOOL_NAME)
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
