import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as schema from '../schema/index.js'
import { startTestDb, type TestDb } from '../testing/container.js'

interface WorkspaceSeed {
  ownerId: string
  workspaceId: string
}

async function seedWorkspace(
  testDb: TestDb,
  label = 'teams',
): Promise<WorkspaceSeed> {
  const ownerId = randomUUID()
  const workspaceId = randomUUID()
  await testDb.db.insert(schema.user).values({
    id: ownerId,
    email: `${ownerId}@example.com`,
    name: 'Team owner',
  })
  await testDb.db.insert(schema.organization).values({
    id: workspaceId,
    name: `${label} workspace`,
    slug: `${label}-${workspaceId}`,
  })
  await testDb.db.insert(schema.member).values({
    organizationId: workspaceId,
    userId: ownerId,
    role: 'owner',
  })
  return { ownerId, workspaceId }
}

async function seedTeam(
  testDb: TestDb,
  workspace: WorkspaceSeed,
  name = 'Engineering',
) {
  const teamId = randomUUID()
  await testDb.db.insert(schema.team).values({
    id: teamId,
    workspaceId: workspace.workspaceId,
    name,
    ownerUserId: workspace.ownerId,
    createdBy: workspace.ownerId,
  })
  await testDb.db.insert(schema.teamMember).values({
    id: randomUUID(),
    teamId,
    workspaceId: workspace.workspaceId,
    userId: workspace.ownerId,
    createdBy: workspace.ownerId,
  })
  return teamId
}

async function seedAgent(testDb: TestDb, workspace: WorkspaceSeed) {
  const agentId = randomUUID()
  await testDb.db.insert(schema.agent).values({
    id: agentId,
    workspaceId: workspace.workspaceId,
    ownerUserId: workspace.ownerId,
    name: 'Research agent',
  })
  return agentId
}

async function seedIssue(
  testDb: TestDb,
  workspace: WorkspaceSeed,
  teamId: string | null,
  number: number,
) {
  const issueId = randomUUID()
  await testDb.db.insert(schema.issue).values({
    id: issueId,
    workspaceId: workspace.workspaceId,
    teamId,
    number,
    title: `Issue ${number}`,
    createdBy: workspace.ownerId,
  })
  return issueId
}

describe('team schema constraints (integration)', () => {
  let testDb: TestDb

  beforeAll(async () => {
    testDb = await startTestDb()
  })

  afterAll(async () => {
    await testDb?.cleanup()
  })

  it('rejects case-insensitive duplicate team names within a workspace', async () => {
    const workspace = await seedWorkspace(testDb, 'dup-name')
    await seedTeam(testDb, workspace, 'Engineering')

    await expect(seedTeam(testDb, workspace, 'engineering')).rejects.toThrow()
  })

  it('allows the same team name in a different workspace', async () => {
    const first = await seedWorkspace(testDb, 'name-a')
    const second = await seedWorkspace(testDb, 'name-b')
    await seedTeam(testDb, first, 'Engineering')
    await expect(seedTeam(testDb, second, 'Engineering')).resolves.toBeTruthy()
  })

  it('requires exactly one membership identity', async () => {
    const workspace = await seedWorkspace(testDb, 'identity')
    const teamId = await seedTeam(testDb, workspace)
    const agentId = await seedAgent(testDb, workspace)

    await expect(
      testDb.db.insert(schema.teamMember).values({
        id: randomUUID(),
        teamId,
        workspaceId: workspace.workspaceId,
        userId: workspace.ownerId,
        agentId,
        createdBy: workspace.ownerId,
      }),
    ).rejects.toThrow()

    await expect(
      testDb.db.insert(schema.teamMember).values({
        id: randomUUID(),
        teamId,
        workspaceId: workspace.workspaceId,
        createdBy: workspace.ownerId,
      }),
    ).rejects.toThrow()
  })

  it('rejects duplicate memberships for the same user and agent', async () => {
    const workspace = await seedWorkspace(testDb, 'dupe-member')
    const teamId = await seedTeam(testDb, workspace)
    const agentId = await seedAgent(testDb, workspace)

    await testDb.db.insert(schema.teamMember).values({
      id: randomUUID(),
      teamId,
      workspaceId: workspace.workspaceId,
      agentId,
      createdBy: workspace.ownerId,
    })

    await expect(
      testDb.db.insert(schema.teamMember).values({
        id: randomUUID(),
        teamId,
        workspaceId: workspace.workspaceId,
        userId: workspace.ownerId,
        createdBy: workspace.ownerId,
      }),
    ).rejects.toThrow()
    await expect(
      testDb.db.insert(schema.teamMember).values({
        id: randomUUID(),
        teamId,
        workspaceId: workspace.workspaceId,
        agentId,
        createdBy: workspace.ownerId,
      }),
    ).rejects.toThrow()
  })

  it('rejects membership rows whose workspace does not match the team', async () => {
    const first = await seedWorkspace(testDb, 'fk-a')
    const second = await seedWorkspace(testDb, 'fk-b')
    const teamId = await seedTeam(testDb, first)

    await expect(
      testDb.db.insert(schema.teamMember).values({
        id: randomUUID(),
        teamId,
        workspaceId: second.workspaceId,
        userId: second.ownerId,
        createdBy: second.ownerId,
      }),
    ).rejects.toThrow()
  })

  it('cascades team members when a team is deleted', async () => {
    const workspace = await seedWorkspace(testDb, 'cascade')
    const teamId = await seedTeam(testDb, workspace)

    await testDb.db.delete(schema.team).where(eq(schema.team.id, teamId))

    const members = await testDb.db
      .select({ id: schema.teamMember.id })
      .from(schema.teamMember)
      .where(eq(schema.teamMember.teamId, teamId))
    expect(members).toHaveLength(0)
  })

  it('restricts team deletion while issues reference it', async () => {
    const workspace = await seedWorkspace(testDb, 'restrict')
    const teamId = await seedTeam(testDb, workspace)
    await seedIssue(testDb, workspace, teamId, 1)

    await expect(
      testDb.db.delete(schema.team).where(eq(schema.team.id, teamId)),
    ).rejects.toThrow()
  })

  it('rejects an issue whose team belongs to another workspace', async () => {
    const first = await seedWorkspace(testDb, 'issue-fk-a')
    const second = await seedWorkspace(testDb, 'issue-fk-b')
    const teamId = await seedTeam(testDb, first)

    await expect(seedIssue(testDb, second, teamId, 1)).rejects.toThrow()
  })

  it('stores team issues alongside workspace issues and filters by team', async () => {
    const workspace = await seedWorkspace(testDb, 'filter')
    const teamId = await seedTeam(testDb, workspace)
    const teamIssueId = await seedIssue(testDb, workspace, teamId, 1)
    const workspaceIssueId = await seedIssue(testDb, workspace, null, 2)

    const rows = await testDb.db
      .select({ id: schema.issue.id })
      .from(schema.issue)
      .where(eq(schema.issue.teamId, teamId))

    expect(rows.map((row) => row.id)).toEqual([teamIssueId])
    const [workspaceIssue] = await testDb.db
      .select({ teamId: schema.issue.teamId })
      .from(schema.issue)
      .where(eq(schema.issue.id, workspaceIssueId))
    expect(workspaceIssue?.teamId).toBeNull()
  })
})
