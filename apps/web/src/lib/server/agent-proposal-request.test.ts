import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as schema from '@garden/db/schema'
import { startTestDb, type TestDb } from '@garden/db/testing'
import type { AppEnv } from './env'
import { resolveAgentProposalRequest } from './agent-proposal-request'

// Match @garden/db's measured testcontainer lifecycle budget. Under the full
// workspace run, concurrent container startup can exceed Vitest's 10s default.
const TEST_DB_HOOK_TIMEOUT_MS = 120_000

async function seedProposal(testDb: TestDb) {
  const userId = randomUUID()
  const workspaceId = randomUUID()
  const proposerAgentId = randomUUID()
  const pendingAgentId = randomUUID()
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
  await testDb.db.insert(schema.agentProposalRequest).values({
    id: requestId,
    agentId: proposerAgentId,
    pendingAgentId,
    argsJson: { name: 'Research agent', role: 'Researcher' },
  })

  return {
    pendingAgentId,
    requestId,
    userId,
    workspaceId,
  }
}

describe('agent proposal request service (integration)', () => {
  let testDb: TestDb

  beforeAll(async () => {
    testDb = await startTestDb()
  }, TEST_DB_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await testDb?.cleanup()
  }, TEST_DB_HOOK_TIMEOUT_MS)

  it('approves a proposal and activates its pending agent', async () => {
    const fixture = await seedProposal(testDb)
    const result = await resolveAgentProposalRequest({
      actorUserId: fixture.userId,
      approved: true,
      db: testDb.db,
      env: {} as AppEnv,
      requestId: fixture.requestId,
      runActor: { type: 'member', id: fixture.userId },
      workspaceId: fixture.workspaceId,
    })

    expect(result.isOk()).toBe(true)
    const [request] = await testDb.db
      .select()
      .from(schema.agentProposalRequest)
      .where(eq(schema.agentProposalRequest.id, fixture.requestId))
    const [agent] = await testDb.db
      .select()
      .from(schema.agent)
      .where(eq(schema.agent.id, fixture.pendingAgentId))

    expect(request?.status).toBe('approved')
    expect(request?.resolvedBy).toBe(fixture.userId)
    expect(request?.resolvedAt).toBeInstanceOf(Date)
    expect(agent?.status).toBe('active')
  })

  it('denies a proposal and archives its pending agent', async () => {
    const fixture = await seedProposal(testDb)
    const result = await resolveAgentProposalRequest({
      actorUserId: fixture.userId,
      approved: false,
      db: testDb.db,
      env: {} as AppEnv,
      requestId: fixture.requestId,
      runActor: { type: 'member', id: fixture.userId },
      workspaceId: fixture.workspaceId,
    })

    expect(result.isOk()).toBe(true)
    const [request] = await testDb.db
      .select()
      .from(schema.agentProposalRequest)
      .where(eq(schema.agentProposalRequest.id, fixture.requestId))
    const [agent] = await testDb.db
      .select()
      .from(schema.agent)
      .where(eq(schema.agent.id, fixture.pendingAgentId))

    expect(request?.status).toBe('denied')
    expect(agent?.status).toBe('archived')
  })
})
