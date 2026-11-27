import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as schema from '@garden/db/schema'
import { startTestDb, type TestDb } from '@garden/db/testing'
import { listIssues } from './server'

const testDbRef = vi.hoisted(() => ({ url: '', db: undefined as unknown }))

// listIssues opens a pooled client from its database URL; hand it the
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

describe('listIssues Team visibility (integration)', () => {
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

  async function seedIssue(args: {
    workspaceId: string
    teamId: string | null
    number: number
    createdBy: string
    assigneeId: string | null
  }) {
    const issueId = randomUUID()
    await testDb.db.insert(schema.issue).values({
      id: issueId,
      workspaceId: args.workspaceId,
      teamId: args.teamId,
      number: args.number,
      title: `Issue ${args.number}`,
      createdBy: args.createdBy,
      assigneeType: args.assigneeId ? 'user' : null,
      assigneeId: args.assigneeId,
    })
    return issueId
  }

  async function seedScenario() {
    const workspaceId = randomUUID()
    await testDb.db.insert(schema.organization).values({
      id: workspaceId,
      name: 'List issues workspace',
      slug: `list-${workspaceId}`,
    })
    const adminId = await seedUser(workspaceId, 'admin')
    const memberId = await seedUser(workspaceId, 'member')
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
      [adminId, memberId].map((userId) => ({
        id: randomUUID(),
        teamId,
        workspaceId,
        userId,
        createdBy: adminId,
      })),
    )
    const teamIssueIds = [
      await seedIssue({
        workspaceId,
        teamId,
        number: 1,
        createdBy: adminId,
        assigneeId: memberId,
      }),
      await seedIssue({
        workspaceId,
        teamId,
        number: 2,
        createdBy: adminId,
        assigneeId: adminId,
      }),
    ]
    const workspaceIssueId = await seedIssue({
      workspaceId,
      teamId: null,
      number: 3,
      createdBy: adminId,
      assigneeId: null,
    })
    return {
      workspaceId,
      adminId,
      memberId,
      nonMemberId,
      teamIssueIds,
      workspaceIssueId,
    }
  }

  async function listAs(workspaceId: string, viewerId: string) {
    const result = await listIssues({
      databaseUrl: testDb.databaseUrl,
      workspaceId,
      ownerUserId: viewerId,
    })
    if (result.isErr()) throw result.error
    return result.value.map((issue) => issue.issue_id).sort()
  }

  it('lists the whole Team board for a Team member, including issues assigned to others', async () => {
    const s = await seedScenario()
    expect(await listAs(s.workspaceId, s.memberId)).toEqual(
      [...s.teamIssueIds, s.workspaceIssueId].sort(),
    )
  })

  it('lists no Team issues for a workspace member outside the Team', async () => {
    const s = await seedScenario()
    expect(await listAs(s.workspaceId, s.nonMemberId)).toEqual([
      s.workspaceIssueId,
    ])
  })

  it('lists every Team issue for a workspace admin', async () => {
    const s = await seedScenario()
    expect(await listAs(s.workspaceId, s.adminId)).toEqual(
      [...s.teamIssueIds, s.workspaceIssueId].sort(),
    )
  })
})
