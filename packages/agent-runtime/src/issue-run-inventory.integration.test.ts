import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as schema from '@garden/db/schema'
import type * as runtimeDb from '@garden/db/runtime'
import { startTestDb, type TestDb } from '@garden/db/testing'
import { listWorkspaceInventoryFromChat } from './chat-sub-agent-tools'

const dbFactory = vi.hoisted(() => ({
  getPooledDb: vi.fn<typeof runtimeDb.getPooledDb>(),
}))

/** Reuses the suite's test DB client, as in chat-create-issue-team.integration.test.ts. */
vi.mock('@garden/db/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof runtimeDb>()),
  getPooledDb: dbFactory.getPooledDb,
}))

vi.mock('@cloudflare/shell', () => ({}))
vi.mock('@cloudflare/think/tools/execute', () => ({}))

type InventoryContext = Parameters<typeof listWorkspaceInventoryFromChat>[0]

let testDb: TestDb

/**
 * Issue #376: issue-run facets are named by run, not by chat thread, so the
 * shared inventory tool failed with "chat thread not found." It must resolve
 * the workspace and agent from the active run identity instead.
 */
describe('list_workspace_inventory in an issue run (integration)', () => {
  const workspaceId = randomUUID()
  const ownerId = randomUUID()
  const agentId = randomUUID()
  // Issue-run DO name; no chat_thread row has this id or runtime key.
  const issueRunFacetName = randomUUID()

  beforeAll(async () => {
    testDb = await startTestDb()
    dbFactory.getPooledDb.mockImplementation(() => testDb.db)
    await testDb.db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Inventory workspace',
      slug: `inventory-${workspaceId}`,
    })
    await testDb.db.insert(schema.user).values({
      id: ownerId,
      name: 'Olu Owner',
      email: `${ownerId}@example.com`,
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
      name: 'Issue agent',
      hostName: agentId,
      permissions: { full_access: true },
    })
  }, 120_000)

  afterAll(async () => {
    await testDb?.cleanup()
  })

  function context(): InventoryContext {
    return {
      databaseUrl: testDb.databaseUrl,
      threadId: issueRunFacetName,
      issueRunEnv: {} as InventoryContext['issueRunEnv'],
      getRunIdentity: () => ({
        workspaceId,
        agentId,
        ownerUserId: ownerId,
        connectorUserId: ownerId,
      }),
    }
  }

  it('lists connectors and agents from the run identity without a chat thread', async () => {
    const result = await listWorkspaceInventoryFromChat(context(), {
      include: ['connectors', 'agents'],
    })
    expect(result.isOk() ? null : result.error).toBeNull()
    const value = result.isOk() ? result.value : null
    expect(value?.current_agent_id).toBe(agentId)
    expect(value?.agents?.map((agent) => agent.id)).toContain(agentId)
    expect(Array.isArray(value?.connectors)).toBe(true)
  })
})
