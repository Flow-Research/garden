import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ToolSet } from 'ai'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'
import * as schema from '@garden/db/schema'
import { buildMcpAiToolKey } from '@garden/connectors/capabilities'
import { Result } from 'better-result'
import { isTestDbReachable } from './test-db'
import {
  RuntimeMcpController,
  type McpHost,
  type ThreadRuntimeIdentity,
} from './runtime-mcp-controller'

const TEST_DB_URL =
  process.env.GARDEN_TEST_DATABASE_URL ??
  'postgres://garden@localhost:5433/garden_test'

const DB_REACHABLE = await isTestDbReachable(TEST_DB_URL)

const TOOL_ARGS = { body: 'probe comment' }
const TOOL_NAME = 'add_issue_comment'
const CONNECTOR_ID = 'github'

let pool: Pool
let db: ReturnType<typeof drizzle<typeof schema>>

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

  await db.insert(schema.user).values({
    id: ownerId,
    email: `${ownerId}@example.com`,
    name: 'Owner',
  })
  await db.insert(schema.organization).values({
    id: workspaceId,
    name: 'Approval workspace',
    slug: `approval-${workspaceId}`,
  })
  await db.insert(schema.member).values({
    organizationId: workspaceId,
    userId: ownerId,
    role: 'owner',
  })
  await db.insert(schema.agent).values({
    id: agentId,
    workspaceId,
    ownerUserId: ownerId,
    name: 'Garden',
    isDefault: true,
  })
  await db.insert(schema.capability).values({
    id: capabilityId,
    connectorType: CONNECTOR_ID,
    name: TOOL_NAME,
    riskClass: 'send_external',
  })
  await db.insert(schema.permissionGrant).values({
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
      HYPERDRIVE: { connectionString: TEST_DB_URL },
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
  await db.insert(schema.permissionRequest).values({
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

  const wrapped = controller.wrapGetAITools(
    () => rawTools,
    undefined,
  )
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

describe.skipIf(!DB_REACHABLE)(
  'connector tool approval gate (integration)',
  () => {
  let seeded: Seeded
  let controller: RuntimeMcpController

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DB_URL })
    db = drizzle(pool, { schema })
    seeded = await seedBase()
    controller = makeController(seeded)
  })

  afterAll(async () => {
    const current = seeded as Seeded | undefined
    if (!current) {
      await pool.end()
      return
    }
    await db
      .delete(schema.permissionRequest)
      .where(eq(schema.permissionRequest.agentId, current.agentId))
    await db
      .delete(schema.inboxItem)
      .where(eq(schema.inboxItem.workspaceId, current.workspaceId))
    await db
      .delete(schema.permissionGrant)
      .where(eq(schema.permissionGrant.agentId, current.agentId))
    await db
      .delete(schema.capability)
      .where(eq(schema.capability.id, current.capabilityId))
    await db.delete(schema.agent).where(eq(schema.agent.id, current.agentId))
    await db
      .delete(schema.member)
      .where(eq(schema.member.userId, current.ownerId))
    await db
      .delete(schema.organization)
      .where(eq(schema.organization.id, current.workspaceId))
    await db.delete(schema.user).where(eq(schema.user.id, current.ownerId))
    await pool.end()
  }, 30_000)

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
      await db.insert(schema.agent).values({
        id: grantlessAgentId,
        workspaceId: seeded.workspaceId,
        ownerUserId: seeded.ownerId,
        name: 'Grantless',
        isDefault: false,
      })
      grantlessController = makeController(seeded, grantlessAgentId)
    })

    afterAll(async () => {
      await db
        .delete(schema.permissionRequest)
        .where(eq(schema.permissionRequest.agentId, grantlessAgentId))
      await db
        .delete(schema.connectionGrant)
        .where(eq(schema.connectionGrant.agentId, grantlessAgentId))
      await db
        .delete(schema.agent)
        .where(eq(schema.agent.id, grantlessAgentId))
    })

    it('uses the connection grant when no tool grant exists', async () => {
      await db.insert(schema.connectionGrant).values({
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
      await db.insert(schema.agent).values({
        id: agentId,
        workspaceId: seeded.workspaceId,
        ownerUserId: seeded.ownerId,
        name: 'Asker',
        isDefault: false,
      })
      await db.insert(schema.connectionGrant).values({
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
        await db
          .delete(schema.permissionRequest)
          .where(eq(schema.permissionRequest.agentId, agentId))
        await db
          .delete(schema.connectionGrant)
          .where(eq(schema.connectionGrant.agentId, agentId))
        await db.delete(schema.agent).where(eq(schema.agent.id, agentId))
      }
    })
  })
})
