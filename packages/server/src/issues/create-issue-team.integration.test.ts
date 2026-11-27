import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as schema from '@garden/db/schema'
import { startTestDb, type TestDb } from '@garden/db/testing'
import { createIssue } from './server'

const testDbRef = vi.hoisted(() => ({ url: '', db: undefined as unknown }))

// The issue services open a pooled client from its database URL; hand it the
// testcontainer's client so no second pool outlives the container.
vi.mock('@garden/db/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@garden/db/runtime')>()
  return {
    ...actual,
    getPooledDb: (connectionString: string) =>
      connectionString === testDbRef.url && testDbRef.db
        ? (testDbRef.db as ReturnType<typeof actual.getPooledDb>)
        : actual.getPooledDb(connectionString),
  }
})

/**
 * Team issue creation rules must hold in the issue service, not only in the
 * web route, because the agent's create_issue tool calls the service directly.
 * Rules mirrored from `apps/web/src/routes/api/issues.ts` (POST):
 * - the creator must be a Team member, unless they are a workspace manager;
 * - a normal member may only assign themselves;
 * - any assignee must be a member of the Team.
 */
describe('createIssue Team rules (integration)', () => {
  let testDb: TestDb

  beforeAll(async () => {
    testDb = await startTestDb()
    testDbRef.url = testDb.databaseUrl
    testDbRef.db = testDb.db
  }, 120_000)

  afterAll(async () => {
    await testDb?.cleanup()
  })

  async function seedUser(workspaceId: string, role: string) {
    const userId = randomUUID()
    await testDb.db.insert(schema.user).values({
      id: userId,
      email: `${userId}@example.com`,
      name: `User ${role}`,
    })
    await testDb.db
      .insert(schema.member)
      .values({ organizationId: workspaceId, userId, role })
    return userId
  }

  async function seedScenario() {
    const workspaceId = randomUUID()
    await testDb.db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Create issue workspace',
      slug: `create-${workspaceId}`,
    })
    const adminId = await seedUser(workspaceId, 'admin')
    const memberId = await seedUser(workspaceId, 'member')
    const otherMemberId = await seedUser(workspaceId, 'member')
    const nonMemberId = await seedUser(workspaceId, 'member')
    const teamId = randomUUID()
    await testDb.db.insert(schema.team).values({
      id: teamId,
      workspaceId,
      name: 'Engineering',
      ownerUserId: adminId,
      createdBy: adminId,
    })
    await testDb.db.insert(schema.teamMember).values(
      [adminId, memberId, otherMemberId].map((userId) => ({
        id: randomUUID(),
        teamId,
        workspaceId,
        userId,
        createdBy: adminId,
      })),
    )
    return {
      workspaceId,
      teamId,
      adminId,
      memberId,
      otherMemberId,
      nonMemberId,
    }
  }

  function create(args: {
    workspaceId: string
    teamId: string
    createdBy: string
    assigneeId?: string
  }) {
    return createIssue({
      databaseUrl: testDb.databaseUrl,
      workspaceId: args.workspaceId,
      teamId: args.teamId,
      title: 'Team issue',
      createdBy: args.createdBy,
      assigneeType: args.assigneeId ? 'user' : null,
      assigneeId: args.assigneeId ?? null,
    })
  }

  it('rejects a Team issue from a workspace member outside the Team', async () => {
    const s = await seedScenario()
    const result = await create({
      workspaceId: s.workspaceId,
      teamId: s.teamId,
      createdBy: s.nonMemberId,
    })
    expect(result.isErr()).toBe(true)
  })

  it('rejects a normal Team member assigning someone else', async () => {
    const s = await seedScenario()
    const result = await create({
      workspaceId: s.workspaceId,
      teamId: s.teamId,
      createdBy: s.memberId,
      assigneeId: s.otherMemberId,
    })
    expect(result.isErr()).toBe(true)
  })

  it('rejects an assignee who is not on the Team', async () => {
    const s = await seedScenario()
    const result = await create({
      workspaceId: s.workspaceId,
      teamId: s.teamId,
      createdBy: s.adminId,
      assigneeId: s.nonMemberId,
    })
    expect(result.isErr()).toBe(true)
  })

  it('lets a Team member create a self-assigned Team issue', async () => {
    const s = await seedScenario()
    const result = await create({
      workspaceId: s.workspaceId,
      teamId: s.teamId,
      createdBy: s.memberId,
      assigneeId: s.memberId,
    })
    expect(result.isOk()).toBe(true)
  })

  it('lets a workspace manager assign any Team member', async () => {
    const s = await seedScenario()
    const result = await create({
      workspaceId: s.workspaceId,
      teamId: s.teamId,
      createdBy: s.adminId,
      assigneeId: s.otherMemberId,
    })
    expect(result.isOk()).toBe(true)
  })
})
