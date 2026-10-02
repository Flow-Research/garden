import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { startTestDb, type TestDb } from '@garden/db/testing'
import { Route as IssuesRoute } from '../issues'
import { Route as IssueRoute } from './$id'
import { Route as IssueCommentsRoute } from './$id/comments'
import { Route as IssueSearchRoute } from './search'
import {
  TEST_DB_HOOK_TIMEOUT_MS,
  handlerFor,
  invocation,
  jsonRequest,
  makeContext,
  seedTeamIssue,
  seedTeamRow,
  seedWorkspace,
} from '../teams/-fixtures'

const envMock = vi.hoisted(() => ({ connectionString: '' }))
const testDbRef = vi.hoisted(() => ({ db: undefined as unknown }))

vi.mock('@/lib/server/env', () => ({
  appEnv: {
    HYPERDRIVE: envMock,
  },
}))

// createIssue builds its own pooled client from the Hyperdrive connection
// string; point it at the test database so no second pool outlives the
// testcontainer.
vi.mock('@garden/db/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@garden/db/runtime')>()
  return {
    ...actual,
    getPooledDb: (connectionString: string) =>
      connectionString === envMock.connectionString && testDbRef.db
        ? (testDbRef.db as ReturnType<typeof actual.getPooledDb>)
        : actual.getPooledDb(connectionString),
  }
})

describe('team issue access (integration)', () => {
  let testDb: TestDb

  beforeAll(async () => {
    testDb = await startTestDb()
    envMock.connectionString = testDb.databaseUrl
    testDbRef.db = testDb.db
  }, TEST_DB_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await testDb?.cleanup()
  })

  async function seedScenario() {
    const fixture = await seedWorkspace(testDb)
    const teamId = await seedTeamRow(testDb, {
      workspaceId: fixture.workspaceId,
      name: 'Engineering',
      ownerUserId: fixture.ownerId,
      memberUserIds: [fixture.memberId],
    })
    const assignedIssueId = await seedTeamIssue(testDb, {
      workspaceId: fixture.workspaceId,
      teamId,
      number: 1,
      createdBy: fixture.ownerId,
      assigneeId: fixture.memberId,
    })
    const otherTeamIssueId = await seedTeamIssue(testDb, {
      workspaceId: fixture.workspaceId,
      teamId,
      number: 2,
      createdBy: fixture.ownerId,
      assigneeId: fixture.ownerId,
    })
    const workspaceIssueId = await seedTeamIssue(testDb, {
      workspaceId: fixture.workspaceId,
      teamId: null,
      number: 3,
      createdBy: fixture.ownerId,
    })
    return {
      fixture,
      teamId,
      assignedIssueId,
      otherTeamIssueId,
      workspaceIssueId,
    }
  }

  it('scopes the issue list to assigned Team issues for normal members', async () => {
    const { fixture, teamId, assignedIssueId, otherTeamIssueId } =
      await seedScenario()

    const memberRequest = new Request(
      `https://garden.test/api/issues?team_id=${teamId}`,
      { headers: { 'X-Workspace-ID': fixture.workspaceId } },
    )
    const memberResponse = await handlerFor(IssuesRoute, 'GET')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.memberId,
          role: 'member',
          request: memberRequest,
        }),
        memberRequest,
        {},
        '/api/issues',
      ),
    )
    const memberBody = (await memberResponse.json()) as {
      issues: Array<{ id: string }>
    }
    expect(memberBody.issues.map((issue) => issue.id)).toEqual([
      assignedIssueId,
    ])

    const managerRequest = new Request(
      `https://garden.test/api/issues?team_id=${teamId}`,
      { headers: { 'X-Workspace-ID': fixture.workspaceId } },
    )
    const managerResponse = await handlerFor(IssuesRoute, 'GET')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.ownerId,
          role: 'owner',
          request: managerRequest,
        }),
        managerRequest,
        {},
        '/api/issues',
      ),
    )
    const managerBody = (await managerResponse.json()) as {
      issues: Array<{ id: string }>
    }
    expect(managerBody.issues.map((issue) => issue.id).sort()).toEqual(
      [assignedIssueId, otherTeamIssueId].sort(),
    )
  })

  it('hides unassigned Team issues from workspace-wide lists', async () => {
    const { fixture, teamId, assignedIssueId, workspaceIssueId } =
      await seedScenario()

    const outsideRequest = new Request('https://garden.test/api/issues', {
      headers: { 'X-Workspace-ID': fixture.workspaceId },
    })
    const outsideResponse = await handlerFor(IssuesRoute, 'GET')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.otherId,
          role: 'member',
          request: outsideRequest,
        }),
        outsideRequest,
        {},
        '/api/issues',
      ),
    )
    const outsideBody = (await outsideResponse.json()) as {
      issues: Array<{ id: string }>
    }
    expect(outsideBody.issues.map((issue) => issue.id)).toEqual([
      workspaceIssueId,
    ])

    const teamMemberRequest = new Request('https://garden.test/api/issues', {
      headers: { 'X-Workspace-ID': fixture.workspaceId },
    })
    const teamMemberResponse = await handlerFor(IssuesRoute, 'GET')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.memberId,
          role: 'member',
          request: teamMemberRequest,
        }),
        teamMemberRequest,
        {},
        '/api/issues',
      ),
    )
    const teamMemberBody = (await teamMemberResponse.json()) as {
      issues: Array<{ id: string }>
    }
    expect(teamMemberBody.issues.map((issue) => issue.id).sort()).toEqual(
      [assignedIssueId, workspaceIssueId].sort(),
    )
    expect(teamId).toBeTruthy()
  })

  it('denies direct reads of another member Team issue', async () => {
    const { fixture, otherTeamIssueId } = await seedScenario()
    const request = new Request(
      `https://garden.test/api/issues/${otherTeamIssueId}`,
      { headers: { 'X-Workspace-ID': fixture.workspaceId } },
    )
    const response = await handlerFor(IssueRoute, 'GET')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.memberId,
          role: 'member',
          request,
        }),
        request,
        { id: otherTeamIssueId },
        '/api/issues/$id',
      ),
    )
    expect(response.status).toBe(403)
    expect(((await response.json()) as { code: string }).code).toBe(
      'ISSUE_TEAM_ACCESS_DENIED',
    )
  })

  it('denies subresources of another member Team issue', async () => {
    const { fixture, otherTeamIssueId } = await seedScenario()
    const request = new Request(
      `https://garden.test/api/issues/${otherTeamIssueId}/comments`,
      { headers: { 'X-Workspace-ID': fixture.workspaceId } },
    )
    const response = await handlerFor(IssueCommentsRoute, 'GET')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.memberId,
          role: 'member',
          request,
        }),
        request,
        { id: otherTeamIssueId },
        '/api/issues/$id/comments',
      ),
    )
    expect(response.status).toBe(403)
  })

  it('excludes inaccessible Team issues from search', async () => {
    const { fixture, otherTeamIssueId, assignedIssueId } = await seedScenario()

    const searchRequest = new Request(
      'https://garden.test/api/issues/search?q=Team',
      { headers: { 'X-Workspace-ID': fixture.workspaceId } },
    )
    const searchResponse = await handlerFor(IssueSearchRoute, 'GET')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.memberId,
          role: 'member',
          request: searchRequest,
        }),
        searchRequest,
        {},
        '/api/issues/search',
      ),
    )
    const searchBody = (await searchResponse.json()) as {
      issues: Array<{ id: string }>
    }
    const ids = searchBody.issues.map((issue) => issue.id)
    expect(ids).toContain(assignedIssueId)
    expect(ids).not.toContain(otherTeamIssueId)
  })

  it('lets Team members create self-assigned Team issues only', async () => {
    const { fixture, teamId } = await seedScenario()

    const selfRequest = jsonRequest(
      'https://garden.test/api/issues',
      fixture.workspaceId,
      'POST',
      {
        title: 'Self assigned',
        team_id: teamId,
        assignee_type: 'member',
        assignee_id: fixture.memberId,
      },
    )
    const selfResponse = await handlerFor(IssuesRoute, 'POST')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.memberId,
          role: 'member',
          request: selfRequest,
        }),
        selfRequest,
        {},
        '/api/issues',
      ),
    )
    expect(selfResponse.status).toBe(201)
    const created = (await selfResponse.json()) as {
      team_id: string
      assignee_id: string
      creator_id: string
    }
    expect(created.team_id).toBe(teamId)
    expect(created.assignee_id).toBe(fixture.memberId)
    expect(created.creator_id).toBe(fixture.memberId)

    const otherRequest = jsonRequest(
      'https://garden.test/api/issues',
      fixture.workspaceId,
      'POST',
      {
        title: 'Assign to other',
        team_id: teamId,
        assignee_type: 'member',
        assignee_id: fixture.ownerId,
      },
    )
    const otherResponse = await handlerFor(IssuesRoute, 'POST')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.memberId,
          role: 'member',
          request: otherRequest,
        }),
        otherRequest,
        {},
        '/api/issues',
      ),
    )
    expect(otherResponse.status).toBe(403)

    const unassignedRequest = jsonRequest(
      'https://garden.test/api/issues',
      fixture.workspaceId,
      'POST',
      { title: 'Unassigned', team_id: teamId },
    )
    const unassignedResponse = await handlerFor(IssuesRoute, 'POST')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.memberId,
          role: 'member',
          request: unassignedRequest,
        }),
        unassignedRequest,
        {},
        '/api/issues',
      ),
    )
    expect(unassignedResponse.status).toBe(400)
  })

  it('rejects Team issue creation by non-members and non-member assignees', async () => {
    const { fixture, teamId } = await seedScenario()

    const outsiderRequest = jsonRequest(
      'https://garden.test/api/issues',
      fixture.workspaceId,
      'POST',
      {
        title: 'Outsider issue',
        team_id: teamId,
        assignee_type: 'member',
        assignee_id: fixture.otherId,
      },
    )
    const outsiderResponse = await handlerFor(IssuesRoute, 'POST')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.otherId,
          role: 'member',
          request: outsiderRequest,
        }),
        outsiderRequest,
        {},
        '/api/issues',
      ),
    )
    expect(outsiderResponse.status).toBe(403)

    const badAssigneeRequest = jsonRequest(
      'https://garden.test/api/issues',
      fixture.workspaceId,
      'POST',
      {
        title: 'Manager issue',
        team_id: teamId,
        assignee_type: 'member',
        assignee_id: fixture.otherId,
      },
    )
    const badAssigneeResponse = await handlerFor(IssuesRoute, 'POST')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.ownerId,
          role: 'owner',
          request: badAssigneeRequest,
        }),
        badAssigneeRequest,
        {},
        '/api/issues',
      ),
    )
    expect(badAssigneeResponse.status).toBe(400)
  })

  it('restricts Team member issue updates to their own assignment', async () => {
    const { fixture, assignedIssueId } = await seedScenario()

    const statusRequest = jsonRequest(
      `https://garden.test/api/issues/${assignedIssueId}`,
      fixture.workspaceId,
      'PUT',
      { status: 'in_progress' },
    )
    const statusResponse = await handlerFor(IssueRoute, 'PUT')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.memberId,
          role: 'member',
          request: statusRequest,
        }),
        statusRequest,
        { id: assignedIssueId },
        '/api/issues/$id',
      ),
    )
    expect(statusResponse.status).toBe(200)

    const reassignRequest = jsonRequest(
      `https://garden.test/api/issues/${assignedIssueId}`,
      fixture.workspaceId,
      'PUT',
      { assignee_id: fixture.ownerId },
    )
    const reassignResponse = await handlerFor(IssueRoute, 'PUT')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.memberId,
          role: 'member',
          request: reassignRequest,
        }),
        reassignRequest,
        { id: assignedIssueId },
        '/api/issues/$id',
      ),
    )
    expect(reassignResponse.status).toBe(403)

    const moveRequest = jsonRequest(
      `https://garden.test/api/issues/${assignedIssueId}`,
      fixture.workspaceId,
      'PUT',
      { team_id: null },
    )
    const moveResponse = await handlerFor(IssueRoute, 'PUT')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.memberId,
          role: 'member',
          request: moveRequest,
        }),
        moveRequest,
        { id: assignedIssueId },
        '/api/issues/$id',
      ),
    )
    expect(moveResponse.status).toBe(403)
  })

  it('validates moves into a Team and manager moves out', async () => {
    const { fixture, teamId, workspaceIssueId } = await seedScenario()

    const unassignedMoveRequest = jsonRequest(
      `https://garden.test/api/issues/${workspaceIssueId}`,
      fixture.workspaceId,
      'PUT',
      { team_id: teamId },
    )
    const unassignedMoveResponse = await handlerFor(IssueRoute, 'PUT')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.ownerId,
          role: 'owner',
          request: unassignedMoveRequest,
        }),
        unassignedMoveRequest,
        { id: workspaceIssueId },
        '/api/issues/$id',
      ),
    )
    expect(unassignedMoveResponse.status).toBe(400)

    const moveInRequest = jsonRequest(
      `https://garden.test/api/issues/${workspaceIssueId}`,
      fixture.workspaceId,
      'PUT',
      { team_id: teamId, assignee_type: 'member', assignee_id: fixture.memberId },
    )
    const moveInResponse = await handlerFor(IssueRoute, 'PUT')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.ownerId,
          role: 'owner',
          request: moveInRequest,
        }),
        moveInRequest,
        { id: workspaceIssueId },
        '/api/issues/$id',
      ),
    )
    expect(moveInResponse.status).toBe(200)
    const moved = (await moveInResponse.json()) as {
      team_id: string | null
      assignee_id: string | null
    }
    expect(moved.team_id).toBe(teamId)
    expect(moved.assignee_id).toBe(fixture.memberId)

    const moveOutRequest = jsonRequest(
      `https://garden.test/api/issues/${workspaceIssueId}`,
      fixture.workspaceId,
      'PUT',
      { team_id: null },
    )
    const moveOutResponse = await handlerFor(IssueRoute, 'PUT')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.ownerId,
          role: 'owner',
          request: moveOutRequest,
        }),
        moveOutRequest,
        { id: workspaceIssueId },
        '/api/issues/$id',
      ),
    )
    expect(moveOutResponse.status).toBe(200)
    const movedOut = (await moveOutResponse.json()) as { team_id: string | null }
    expect(movedOut.team_id).toBeNull()
  })
})
