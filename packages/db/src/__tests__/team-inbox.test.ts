import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { upsertWaitingForInputInbox } from '../inbox.js'
import * as schema from '../schema/index.js'
import { startTestDb, type TestDb } from '../testing/container.js'

async function seedUser(
  testDb: TestDb,
  workspaceId: string | null,
  role: 'owner' | 'admin' | 'member' = 'member',
) {
  const userId = randomUUID()
  await testDb.db.insert(schema.user).values({
    id: userId,
    email: `${userId}@example.com`,
    name: `User ${role}`,
  })
  if (workspaceId) {
    await testDb.db.insert(schema.member).values({
      organizationId: workspaceId,
      userId,
      role,
    })
  }
  return userId
}

async function seedWorkspace(testDb: TestDb) {
  const workspaceId = randomUUID()
  await testDb.db.insert(schema.organization).values({
    id: workspaceId,
    name: 'Team inbox workspace',
    slug: `team-inbox-${workspaceId}`,
  })
  const ownerId = await seedUser(testDb, workspaceId, 'owner')
  return { workspaceId, ownerId }
}

/**
 * Builds a Team-linked waiting_for_input item and returns the recipients that
 * were written for its run key.
 */
async function writeTeamItem(
  testDb: TestDb,
  args: {
    workspaceId: string
    ownerId: string
    agentOwnerId: string
    teamOwnerId: string
    assigneeId: string | null
  },
) {
  const teamId = randomUUID()
  const agentId = randomUUID()
  const issueId = randomUUID()
  const runId = randomUUID()

  await testDb.db.insert(schema.team).values({
    id: teamId,
    workspaceId: args.workspaceId,
    name: `Team ${teamId.slice(0, 8)}`,
    ownerUserId: args.teamOwnerId,
    createdBy: args.ownerId,
  })
  await testDb.db.insert(schema.agent).values({
    id: agentId,
    workspaceId: args.workspaceId,
    ownerUserId: args.agentOwnerId,
    name: 'Routing agent',
  })
  await testDb.db.insert(schema.issue).values({
    id: issueId,
    workspaceId: args.workspaceId,
    teamId,
    number: 1,
    title: 'Team routing issue',
    createdBy: args.ownerId,
    assigneeType: args.assigneeId ? 'user' : null,
    assigneeId: args.assigneeId,
  })

  await upsertWaitingForInputInbox({
    db: testDb.db,
    workspaceId: args.workspaceId,
    issueId,
    runId,
    agentId,
  })

  const rows = await testDb.db
    .select({ recipientId: schema.inboxItem.recipientId })
    .from(schema.inboxItem)
    .where(eq(schema.inboxItem.itemKey, `waiting_for_input:${runId}`))
  return rows.map((row) => row.recipientId)
}

describe('team inbox routing (integration)', () => {
  let testDb: TestDb

  beforeAll(async () => {
    testDb = await startTestDb()
  }, 120_000)

  afterAll(async () => {
    await testDb?.cleanup()
  })

  it('routes to the agent owner first', async () => {
    const { workspaceId, ownerId } = await seedWorkspace(testDb)
    const agentOwnerId = await seedUser(testDb, workspaceId)
    const assigneeId = await seedUser(testDb, workspaceId)
    const teamOwnerId = await seedUser(testDb, workspaceId)

    const recipients = await writeTeamItem(testDb, {
      workspaceId,
      ownerId,
      agentOwnerId,
      teamOwnerId,
      assigneeId,
    })

    expect(recipients).toEqual([agentOwnerId])
  })

  it('falls back to the issue assignee when the agent owner is not a workspace user', async () => {
    const { workspaceId, ownerId } = await seedWorkspace(testDb)
    const outsiderId = await seedUser(testDb, null)
    const assigneeId = await seedUser(testDb, workspaceId)
    const teamOwnerId = await seedUser(testDb, workspaceId)

    const recipients = await writeTeamItem(testDb, {
      workspaceId,
      ownerId,
      agentOwnerId: outsiderId,
      teamOwnerId,
      assigneeId,
    })

    expect(recipients).toEqual([assigneeId])
  })

  it('falls back to the Team owner when there is no agent owner or assignee', async () => {
    const { workspaceId, ownerId } = await seedWorkspace(testDb)
    const outsiderId = await seedUser(testDb, null)
    const teamOwnerId = await seedUser(testDb, workspaceId)

    const recipients = await writeTeamItem(testDb, {
      workspaceId,
      ownerId,
      agentOwnerId: outsiderId,
      teamOwnerId,
      assigneeId: null,
    })

    expect(recipients).toEqual([teamOwnerId])
  })

  it('falls back to workspace owner/admin when no Team candidate is eligible', async () => {
    const { workspaceId, ownerId } = await seedWorkspace(testDb)
    const outsiderId = await seedUser(testDb, null)
    const outsiderTeamOwnerId = await seedUser(testDb, null)

    const recipients = await writeTeamItem(testDb, {
      workspaceId,
      ownerId,
      agentOwnerId: outsiderId,
      teamOwnerId: outsiderTeamOwnerId,
      assigneeId: null,
    })

    expect(recipients).toEqual([ownerId])
  })

  it('deduplicates when one person matches every rule', async () => {
    const { workspaceId, ownerId } = await seedWorkspace(testDb)
    const sameUserId = await seedUser(testDb, workspaceId)

    const recipients = await writeTeamItem(testDb, {
      workspaceId,
      ownerId,
      agentOwnerId: sameUserId,
      teamOwnerId: sameUserId,
      assigneeId: sameUserId,
    })

    expect(recipients).toEqual([sameUserId])
  })

  it('writes nothing when no eligible recipient exists', async () => {
    const workspaceId = randomUUID()
    await testDb.db.insert(schema.organization).values({
      id: workspaceId,
      name: 'No approver workspace',
      slug: `no-approver-${workspaceId}`,
    })
    const memberId = await seedUser(testDb, workspaceId, 'member')
    const outsiderId = await seedUser(testDb, null)
    const outsiderTeamOwnerId = await seedUser(testDb, null)

    const recipients = await writeTeamItem(testDb, {
      workspaceId,
      ownerId: memberId,
      agentOwnerId: outsiderId,
      teamOwnerId: outsiderTeamOwnerId,
      assigneeId: null,
    })

    expect(recipients).toEqual([])
  })

  it('keeps workspace item recipients unchanged', async () => {
    const { workspaceId, ownerId } = await seedWorkspace(testDb)
    const agentOwnerId = await seedUser(testDb, workspaceId)
    const agentId = randomUUID()
    const issueId = randomUUID()
    const runId = randomUUID()

    await testDb.db.insert(schema.agent).values({
      id: agentId,
      workspaceId,
      ownerUserId: agentOwnerId,
      name: 'Workspace agent',
    })
    await testDb.db.insert(schema.issue).values({
      id: issueId,
      workspaceId,
      teamId: null,
      number: 2,
      title: 'Workspace issue',
      createdBy: ownerId,
    })

    await upsertWaitingForInputInbox({
      db: testDb.db,
      workspaceId,
      issueId,
      runId,
      agentId,
    })

    const rows = await testDb.db
      .select({ recipientId: schema.inboxItem.recipientId })
      .from(schema.inboxItem)
      .where(
        and(
          eq(schema.inboxItem.workspaceId, workspaceId),
          eq(schema.inboxItem.itemKey, `waiting_for_input:${runId}`),
        ),
      )
    // Workspace issues keep creator + assignee routing; here that is just the
    // creator because the issue is unassigned.
    expect(rows.map((row) => row.recipientId).sort()).toEqual([ownerId].sort())
  })
})
