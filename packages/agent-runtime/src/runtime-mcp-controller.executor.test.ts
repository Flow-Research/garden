import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ToolSet } from 'ai'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { and, eq } from 'drizzle-orm'
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

const EXECUTOR_TOOL = 'execute'
const GMAIL_LIST_CODE =
  'await tools.google_gmail.user.gmail.gmail.users.messages.list({ userId: "me" })'
const UNKNOWN_CODE = 'await tools.custom_crm.user.main.get_record({})'

type Seeded = {
  ownerId: string
  workspaceId: string
  agentId: string
  capabilityId: string
}

let pool: Pool
let db: ReturnType<typeof drizzle<typeof schema>>

async function seedBase(trustLevel: string): Promise<Seeded> {
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
    name: 'Executor gate workspace',
    slug: `executor-gate-${workspaceId}`,
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
    connectorType: 'gmail',
    name: 'gmail.users.messages.list',
    riskClass: 'read',
  })
  await db.insert(schema.permissionGrant).values({
    id: randomUUID(),
    agentId,
    capabilityId,
    trustLevel,
    grantedBy: ownerId,
  })

  return { ownerId, workspaceId, agentId, capabilityId }
}

async function cleanupSeeded(seeded: Seeded) {
  await db
    .delete(schema.permissionRequest)
    .where(eq(schema.permissionRequest.agentId, seeded.agentId))
  await db
    .delete(schema.inboxItem)
    .where(eq(schema.inboxItem.workspaceId, seeded.workspaceId))
  await db
    .delete(schema.permissionGrant)
    .where(eq(schema.permissionGrant.agentId, seeded.agentId))
  await db
    .delete(schema.capability)
    .where(eq(schema.capability.id, seeded.capabilityId))
  await db.delete(schema.agent).where(eq(schema.agent.id, seeded.agentId))
  await db
    .delete(schema.member)
    .where(eq(schema.member.userId, seeded.ownerId))
  await db
    .delete(schema.organization)
    .where(eq(schema.organization.id, seeded.workspaceId))
  await db.delete(schema.user).where(eq(schema.user.id, seeded.ownerId))
}

function makeController(seeded: Seeded) {
  const identity: ThreadRuntimeIdentity = {
    threadId: randomUUID(),
    workspaceId: seeded.workspaceId,
    userId: randomUUID(),
    agentId: seeded.agentId,
  }

  const host = {
    name: 'executor-gate-probe',
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
          name: EXECUTOR_TOOL,
          serverId: 'executor',
          description: 'Run code against connected integrations.',
          inputSchema: {},
        },
      ],
      listServers: () => [{ id: 'executor' }],
      discoverIfConnected: async () => ({ success: true }),
    },
    removeMcpServer: async () => {},
    resolveRuntimeIdentity: async () => Result.ok(identity),
  } as unknown as McpHost

  return new RuntimeMcpController(host)
}

async function needsApprovalForExecute(
  controller: RuntimeMcpController,
  code: string,
  toolCallId: string,
): Promise<boolean> {
  const rawToolKey = buildMcpAiToolKey('executor', EXECUTOR_TOOL)
  const rawTools = {
    [rawToolKey]: {
      name: EXECUTOR_TOOL,
      description: 'probe executor tool',
      inputSchema: {},
    },
  } as unknown as ToolSet

  const wrapped = controller.wrapGetAITools(() => rawTools, undefined)
  const tool = wrapped[rawToolKey] as unknown as {
    needsApproval?: (
      input: unknown,
      options: { toolCallId: string; messages: unknown[] },
    ) => Promise<boolean>
  }

  expect(tool?.needsApproval).toBeDefined()

  return await tool.needsApproval!({ code }, { toolCallId, messages: [] })
}

describe.skipIf(!DB_REACHABLE)(
  'executor tool approval gate (integration)',
  () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DB_URL })
    db = drizzle(pool, { schema })
  })

  afterAll(async () => {
    await pool.end()
  })

  it('asks when codemode touches an ask-granted executor tool', async () => {
    const seeded = await seedBase('ask')
    try {
      const controller = makeController(seeded)
      const toolCallId = `call-${randomUUID()}`
      const result = await needsApprovalForExecute(
        controller,
        GMAIL_LIST_CODE,
        toolCallId,
      )
      expect(result).toBe(true)

      const requests = await db
        .select({ id: schema.permissionRequest.id })
        .from(schema.permissionRequest)
        .where(
          and(
            eq(schema.permissionRequest.agentId, seeded.agentId),
            eq(schema.permissionRequest.capabilityId, seeded.capabilityId),
            eq(schema.permissionRequest.toolCallId, toolCallId),
          ),
        )
      expect(requests).toHaveLength(1)
    } finally {
      await cleanupSeeded(seeded)
    }
  })

  it('allows codemode touching an allow-granted executor tool', async () => {
    const seeded = await seedBase('allow')
    try {
      const controller = makeController(seeded)
      const result = await needsApprovalForExecute(
        controller,
        GMAIL_LIST_CODE,
        `call-${randomUUID()}`,
      )
      expect(result).toBe(false)
    } finally {
      await cleanupSeeded(seeded)
    }
  })

  it('ignores unmapped integrations instead of blocking', async () => {
    const seeded = await seedBase('ask')
    try {
      const controller = makeController(seeded)
      const result = await needsApprovalForExecute(
        controller,
        UNKNOWN_CODE,
        `call-${randomUUID()}`,
      )
      expect(result).toBe(false)
    } finally {
      await cleanupSeeded(seeded)
    }
  })
})
