import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '@garden/db/schema'
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

  /** Calls one route handler as a workspace user and returns the response. */
  async function callAs(args: {
    route: unknown
    method?: string
    url: string
    workspaceId: string
    userId: string
    role: 'owner' | 'admin' | 'member'
    params?: Record<string, string>
    body?: unknown
  }): Promise<Response> {
    const request = jsonRequest(
      `https://garden.test${args.url}`,
      args.workspaceId,
      args.method ?? 'GET',
      args.body,
    )
    return handlerFor(
      args.route,
      args.method ?? 'GET',
    )(
      invocation(
        makeContext({
          testDb,
          userId: args.userId,
          role: args.role,
          request,
        }),
        request,
        args.params ?? {},
        new URL(request.url).pathname,
      ),
    )
  }

  async function issueIds(response: Response): Promise<string[]> {
    const body = (await response.json()) as { issues: Array<{ id: string }> }
    return body.issues.map((issue) => issue.id).sort()
  }

  it('shows the whole Team board to every Team member', async () => {
    const { fixture, teamId, assignedIssueId, otherTeamIssueId } =
      await seedScenario()
    const board = `/api/issues?team_id=${teamId}`
    const wholeBoard = [assignedIssueId, otherTeamIssueId].sort()

    const member = await callAs({
      route: IssuesRoute,
      url: board,
      workspaceId: fixture.workspaceId,
      userId: fixture.memberId,
      role: 'member',
    })
    expect(await issueIds(member)).toEqual(wholeBoard)

    const nonMember = await callAs({
      route: IssuesRoute,
      url: board,
      workspaceId: fixture.workspaceId,
      userId: fixture.otherId,
      role: 'member',
    })
    expect(await issueIds(nonMember)).toEqual([])

    const manager = await callAs({
      route: IssuesRoute,
      url: board,
      workspaceId: fixture.workspaceId,
      userId: fixture.ownerId,
      role: 'owner',
    })
    expect(await issueIds(manager)).toEqual(wholeBoard)
  })

  /**
   * has_team=true must push team_id IS NOT NULL into SQL so cross-team lists
   * never return workspace-only issues (issue #153). Without this filter the
   * Teams › Issues surface fetched every workspace row and discarded
   * non-team ones client-side.
   */
  it('lists only team issues when has_team=true', async () => {
    const { fixture, assignedIssueId, otherTeamIssueId, workspaceIssueId } =
      await seedScenario()

    const request = new Request(
      'https://garden.test/api/issues?has_team=true',
      { headers: { 'X-Workspace-ID': fixture.workspaceId } },
    )
    const response = await handlerFor(
      IssuesRoute,
      'GET',
    )(
      invocation(
        makeContext({
          testDb,
          userId: fixture.ownerId,
          role: 'owner',
          request,
        }),
        request,
        {},
        '/api/issues',
      ),
    )
    const body = (await response.json()) as {
      issues: Array<{ id: string; team_id: string | null }>
    }
    const ids = body.issues.map((issue) => issue.id).sort()
    expect(ids).toEqual([assignedIssueId, otherTeamIssueId].sort())
    expect(ids).not.toContain(workspaceIssueId)
    expect(body.issues.every((issue) => issue.team_id !== null)).toBe(true)
  })

  it('hides Team issues from non-members in workspace-wide lists', async () => {
    const { fixture, assignedIssueId, otherTeamIssueId, workspaceIssueId } =
      await seedScenario()

    const nonMember = await callAs({
      route: IssuesRoute,
      url: '/api/issues',
      workspaceId: fixture.workspaceId,
      userId: fixture.otherId,
      role: 'member',
    })
    expect(await issueIds(nonMember)).toEqual([workspaceIssueId])

    const member = await callAs({
      route: IssuesRoute,
      url: '/api/issues',
      workspaceId: fixture.workspaceId,
      userId: fixture.memberId,
      role: 'member',
    })
    expect(await issueIds(member)).toEqual(
      [assignedIssueId, otherTeamIssueId, workspaceIssueId].sort(),
    )
  })

  it('lets a Team member open a Team issue assigned to someone else', async () => {
    const { fixture, otherTeamIssueId } = await seedScenario()

    const detail = await callAs({
      route: IssueRoute,
      url: `/api/issues/${otherTeamIssueId}`,
      workspaceId: fixture.workspaceId,
      userId: fixture.memberId,
      role: 'member',
      params: { id: otherTeamIssueId },
    })
    expect(detail.status).toBe(200)
    expect(((await detail.json()) as { id: string }).id).toBe(otherTeamIssueId)

    const comments = await callAs({
      route: IssueCommentsRoute,
      url: `/api/issues/${otherTeamIssueId}/comments`,
      workspaceId: fixture.workspaceId,
      userId: fixture.memberId,
      role: 'member',
      params: { id: otherTeamIssueId },
    })
    expect(comments.status).toBe(200)
  })

  it('denies Team issue reads and subresources to non-members', async () => {
    const { fixture, otherTeamIssueId } = await seedScenario()

    const detail = await callAs({
      route: IssueRoute,
      url: `/api/issues/${otherTeamIssueId}`,
      workspaceId: fixture.workspaceId,
      userId: fixture.otherId,
      role: 'member',
      params: { id: otherTeamIssueId },
    })
    expect(detail.status).toBe(403)
    expect(((await detail.json()) as { code: string }).code).toBe(
      'ISSUE_TEAM_ACCESS_DENIED',
    )

    const comments = await callAs({
      route: IssueCommentsRoute,
      url: `/api/issues/${otherTeamIssueId}/comments`,
      workspaceId: fixture.workspaceId,
      userId: fixture.otherId,
      role: 'member',
      params: { id: otherTeamIssueId },
    })
    expect(comments.status).toBe(403)
  })

  it('searches the whole Team board for members and none of it for non-members', async () => {
    const { fixture, otherTeamIssueId, assignedIssueId } = await seedScenario()
    const search = '/api/issues/search?q=Team'

    const member = await callAs({
      route: IssueSearchRoute,
      url: search,
      workspaceId: fixture.workspaceId,
      userId: fixture.memberId,
      role: 'member',
    })
    const memberIds = await issueIds(member)
    expect(memberIds).toContain(assignedIssueId)
    expect(memberIds).toContain(otherTeamIssueId)

    const nonMember = await callAs({
      route: IssueSearchRoute,
      url: search,
      workspaceId: fixture.workspaceId,
      userId: fixture.otherId,
      role: 'member',
    })
    const nonMemberIds = await issueIds(nonMember)
    expect(nonMemberIds).not.toContain(assignedIssueId)
    expect(nonMemberIds).not.toContain(otherTeamIssueId)
  })

  it('lets a Team member move any Team issue on the board but not reassign it to others', async () => {
    const { fixture, otherTeamIssueId } = await seedScenario()

    const moved = await callAs({
      route: IssueRoute,
      method: 'PUT',
      url: `/api/issues/${otherTeamIssueId}`,
      workspaceId: fixture.workspaceId,
      userId: fixture.memberId,
      role: 'member',
      params: { id: otherTeamIssueId },
      body: { status: 'in_progress', position: 'a1' },
    })
    expect(moved.status).toBe(200)
    expect(((await moved.json()) as { status: string }).status).toBe(
      'in_progress',
    )

    const reassigned = await callAs({
      route: IssueRoute,
      method: 'PUT',
      url: `/api/issues/${otherTeamIssueId}`,
      workspaceId: fixture.workspaceId,
      userId: fixture.memberId,
      role: 'member',
      params: { id: otherTeamIssueId },
      body: { assignee_id: fixture.adminId },
    })
    expect(reassigned.status).toBe(403)

    const nonMember = await callAs({
      route: IssueRoute,
      method: 'PUT',
      url: `/api/issues/${otherTeamIssueId}`,
      workspaceId: fixture.workspaceId,
      userId: fixture.otherId,
      role: 'member',
      params: { id: otherTeamIssueId },
      body: { status: 'done' },
    })
    expect(nonMember.status).toBe(403)
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
    const selfResponse = await handlerFor(
      IssuesRoute,
      'POST',
    )(
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
    const otherResponse = await handlerFor(
      IssuesRoute,
      'POST',
    )(
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
    const unassignedResponse = await handlerFor(
      IssuesRoute,
      'POST',
    )(
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
    expect(unassignedResponse.status).toBe(201)
    const unassigned = (await unassignedResponse.json()) as {
      assignee_id: string | null
    }
    expect(unassigned.assignee_id).toBeNull()
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
    const outsiderResponse = await handlerFor(
      IssuesRoute,
      'POST',
    )(
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
    const badAssigneeResponse = await handlerFor(
      IssuesRoute,
      'POST',
    )(
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

  it('limits Team members to self-assignment and keeps Team moves with managers', async () => {
    const { fixture, assignedIssueId } = await seedScenario()

    const statusRequest = jsonRequest(
      `https://garden.test/api/issues/${assignedIssueId}`,
      fixture.workspaceId,
      'PUT',
      { status: 'in_progress' },
    )
    const statusResponse = await handlerFor(
      IssueRoute,
      'PUT',
    )(
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
    const reassignResponse = await handlerFor(
      IssueRoute,
      'PUT',
    )(
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
    const moveResponse = await handlerFor(
      IssueRoute,
      'PUT',
    )(
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
    const unassignedMoveResponse = await handlerFor(
      IssueRoute,
      'PUT',
    )(
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
    expect(unassignedMoveResponse.status).toBe(200)

    const moveInRequest = jsonRequest(
      `https://garden.test/api/issues/${workspaceIssueId}`,
      fixture.workspaceId,
      'PUT',
      {
        team_id: teamId,
        assignee_type: 'member',
        assignee_id: fixture.memberId,
      },
    )
    const moveInResponse = await handlerFor(
      IssueRoute,
      'PUT',
    )(
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
    const moveOutResponse = await handlerFor(
      IssueRoute,
      'PUT',
    )(
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
    const movedOut = (await moveOutResponse.json()) as {
      team_id: string | null
    }
    expect(movedOut.team_id).toBeNull()
  })

  it('allows unassigned Team issues but keeps assignees inside the Team', async () => {
    const { fixture, teamId, assignedIssueId, workspaceIssueId } =
      await seedScenario()
    const asOwner = {
      workspaceId: fixture.workspaceId,
      userId: fixture.ownerId,
      role: 'owner' as const,
    }

    const moveUnassigned = await callAs({
      ...asOwner,
      route: IssueRoute,
      method: 'PUT',
      url: `/api/issues/${workspaceIssueId}`,
      params: { id: workspaceIssueId },
      body: { team_id: teamId },
    })
    expect(moveUnassigned.status).toBe(200)
    const moved = (await moveUnassigned.json()) as {
      team_id: string | null
      assignee_id: string | null
    }
    expect(moved.team_id).toBe(teamId)
    expect(moved.assignee_id).toBeNull()

    const clearAssignee = await callAs({
      ...asOwner,
      route: IssueRoute,
      method: 'PUT',
      url: `/api/issues/${assignedIssueId}`,
      params: { id: assignedIssueId },
      body: { assignee_id: null },
    })
    expect(clearAssignee.status).toBe(200)
    const cleared = (await clearAssignee.json()) as {
      team_id: string | null
      assignee_id: string | null
    }
    expect(cleared.team_id).toBe(teamId)
    expect(cleared.assignee_id).toBeNull()

    const outsiderIssueId = await seedTeamIssue(testDb, {
      workspaceId: fixture.workspaceId,
      teamId: null,
      number: 50,
      createdBy: fixture.ownerId,
      assigneeId: fixture.otherId,
    })
    const moveWithOutsider = await callAs({
      ...asOwner,
      route: IssueRoute,
      method: 'PUT',
      url: `/api/issues/${outsiderIssueId}`,
      params: { id: outsiderIssueId },
      body: { team_id: teamId },
    })
    expect(moveWithOutsider.status).toBe(400)
    expect(await moveWithOutsider.text()).toContain(
      'Assignee must be a Team member',
    )

    const createUnassigned = await callAs({
      ...asOwner,
      route: IssuesRoute,
      method: 'POST',
      url: '/api/issues',
      body: { title: 'Unassigned team issue', team_id: teamId },
    })
    expect(createUnassigned.status).toBe(201)
    const created = (await createUnassigned.json()) as {
      team_id: string | null
      assignee_id: string | null
    }
    expect(created.team_id).toBe(teamId)
    expect(created.assignee_id).toBeNull()
  })

  it('renders identifiers with the workspace issue prefix on list, detail, and update', async () => {
    const fixture = await seedWorkspace(testDb)
    // A non-default prefix proves the routes resolve the organization row
    // instead of falling back to 'ISS' (which disagreed with create).
    await testDb.db
      .update(schema.organization)
      .set({ issuePrefix: 'GAR' })
      .where(eq(schema.organization.id, fixture.workspaceId))
    const issueId = await seedTeamIssue(testDb, {
      workspaceId: fixture.workspaceId,
      teamId: null,
      number: 42,
      createdBy: fixture.ownerId,
    })

    const listRequest = new Request('https://garden.test/api/issues', {
      headers: { 'X-Workspace-ID': fixture.workspaceId },
    })
    const listResponse = await handlerFor(
      IssuesRoute,
      'GET',
    )(
      invocation(
        makeContext({
          testDb,
          userId: fixture.ownerId,
          role: 'owner',
          request: listRequest,
        }),
        listRequest,
        {},
        '/api/issues',
      ),
    )
    const listBody = (await listResponse.json()) as {
      issues: Array<{ id: string; identifier: string }>
    }
    expect(
      listBody.issues.find((issue) => issue.id === issueId)?.identifier,
    ).toBe('GAR-42')

    const detailRequest = new Request(
      `https://garden.test/api/issues/${issueId}`,
      { headers: { 'X-Workspace-ID': fixture.workspaceId } },
    )
    const detailResponse = await handlerFor(
      IssueRoute,
      'GET',
    )(
      invocation(
        makeContext({
          testDb,
          userId: fixture.ownerId,
          role: 'owner',
          request: detailRequest,
        }),
        detailRequest,
        { id: issueId },
        '/api/issues/$id',
      ),
    )
    const detailBody = (await detailResponse.json()) as { identifier: string }
    expect(detailBody.identifier).toBe('GAR-42')

    const updateRequest = jsonRequest(
      `https://garden.test/api/issues/${issueId}`,
      fixture.workspaceId,
      'PUT',
      { title: 'Prefixed issue' },
    )
    const updateResponse = await handlerFor(
      IssueRoute,
      'PUT',
    )(
      invocation(
        makeContext({
          testDb,
          userId: fixture.ownerId,
          role: 'owner',
          request: updateRequest,
        }),
        updateRequest,
        { id: issueId },
        '/api/issues/$id',
      ),
    )
    const updateBody = (await updateResponse.json()) as { identifier: string }
    expect(updateBody.identifier).toBe('GAR-42')
  })
})
