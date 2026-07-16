import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { upsertAgentProposalRequestInbox } from '../inbox.js'
import * as schema from '../schema/index.js'
import { startTestDb, type TestDb } from '../testing/container.js'

async function seedProposal(
  testDb: TestDb,
  status: 'approved' | 'denied' | 'pending' = 'pending',
) {
  const userId = randomUUID()
  const workspaceId = randomUUID()
  const proposerAgentId = randomUUID()
  const pendingAgentId = randomUUID()
  const threadId = randomUUID()
  const requestId = randomUUID()

  await testDb.db.insert(schema.user).values({
    id: userId,
    email: `${userId}@example.com`,
    name: 'Proposal approver',
  })
  await testDb.db.insert(schema.organization).values({
    id: workspaceId,
    name: 'Proposal workspace',
    slug: `proposal-${workspaceId}`,
  })
  await testDb.db.insert(schema.member).values({
    organizationId: workspaceId,
    userId,
    role: 'owner',
  })
  await testDb.db.insert(schema.agent).values([
    {
      id: proposerAgentId,
      workspaceId,
      ownerUserId: userId,
      name: 'Garden',
      isDefault: true,
    },
    {
      id: pendingAgentId,
      workspaceId,
      ownerUserId: userId,
      name: 'Research agent',
      status: 'pending_approval',
    },
  ])
  await testDb.db.insert(schema.chatThread).values({
    id: threadId,
    workspaceId,
    ownerUserId: userId,
    agentId: proposerAgentId,
    runtimeKey: threadId,
    title: 'Agent proposal',
  })
  await testDb.db.insert(schema.agentProposalRequest).values({
    id: requestId,
    agentId: proposerAgentId,
    pendingAgentId,
    threadId,
    argsJson: { name: 'Research agent', role: 'Investigates customer needs' },
    status,
  })

  return {
    pendingAgentId,
    requestId,
    userId,
    workspaceId,
  }
}

describe('agent proposal ledger (integration)', () => {
  let testDb: TestDb

  beforeAll(async () => {
    testDb = await startTestDb()
  })

  afterAll(async () => {
    await testDb?.cleanup()
  })

  it('creates a proposal without writing the connector permission ledger', async () => {
    const fixture = await seedProposal(testDb)

    const [proposal] = await testDb.db
      .select()
      .from(schema.agentProposalRequest)
      .where(eq(schema.agentProposalRequest.id, fixture.requestId))
    const legacyRows = await testDb.db
      .select({ id: schema.permissionRequest.id })
      .from(schema.permissionRequest)
      .where(eq(schema.permissionRequest.id, fixture.requestId))

    expect(proposal?.pendingAgentId).toBe(fixture.pendingAgentId)
    expect(proposal?.status).toBe('pending')
    expect(legacyRows).toHaveLength(0)
  })

  it('adds pending proposals to approver inboxes and ignores resolved proposals', async () => {
    const pending = await seedProposal(testDb)
    const denied = await seedProposal(testDb, 'denied')

    await upsertAgentProposalRequestInbox({
      db: testDb.db,
      workspaceId: pending.workspaceId,
      requestId: pending.requestId,
    })
    await upsertAgentProposalRequestInbox({
      db: testDb.db,
      workspaceId: denied.workspaceId,
      requestId: denied.requestId,
    })

    const rows = await testDb.db
      .select()
      .from(schema.inboxItem)
      .where(
        and(
          eq(schema.inboxItem.workspaceId, pending.workspaceId),
          eq(schema.inboxItem.itemKey, `approval:${pending.requestId}`),
        ),
      )
    const deniedRows = await testDb.db
      .select()
      .from(schema.inboxItem)
      .where(
        and(
          eq(schema.inboxItem.workspaceId, denied.workspaceId),
          eq(schema.inboxItem.itemKey, `approval:${denied.requestId}`),
        ),
      )

    expect(rows).toHaveLength(1)
    expect(rows[0]?.recipientId).toBe(pending.userId)
    expect(rows[0]?.title).toBe('Agent proposal needs approval')
    expect(rows[0]?.body).toBe('Research agent — Investigates customer needs')
    expect(rows[0]?.details).toMatchObject({
      kind: 'agent_proposal',
      request_id: pending.requestId,
      pending_agent_id: pending.pendingAgentId,
    })
    expect(deniedRows).toHaveLength(0)
  })
})

describe('agent proposal migration', () => {
  it('copies every legacy proposal and rejects malformed pending-agent context', () => {
    const migration = readFileSync(
      new URL('../../drizzle/0040_supreme_may_parker.sql', import.meta.url),
      'utf8',
    )

    expect(migration).toContain('INSERT INTO "agent_proposal_request"')
    expect(migration).toContain('WHERE "kind" = \'agent_proposal\'')
    expect(migration).toContain(
      'Cannot migrate agent proposal request with malformed pending-agent context',
    )
  })
})
