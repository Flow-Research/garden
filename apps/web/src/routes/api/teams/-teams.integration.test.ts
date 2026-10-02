import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as schema from '@garden/db/schema'
import { startTestDb, type TestDb } from '@garden/db/testing'
import type { AppRequestContext } from '@/lib/server/context'
import { Route as TeamsRoute } from '../teams'
import { Route as TeamRoute } from './$teamId'
import { Route as TeamMembersRoute } from './$teamId/members'
import { Route as TeamMemberRoute } from './$teamId/members/$membershipId'
import { Route as TeamOwnerRoute } from './$teamId/owner'

const TEST_DB_HOOK_TIMEOUT_MS = 120_000

type FakeRole = 'owner' | 'admin' | 'member'

interface WorkspaceFixture {
  workspaceId: string
  ownerId: string
  adminId: string
  memberId: string
  otherId: string
  outsiderId: string
  activeAgentId: string
  archivedAgentId: string
}

function handlerFor(route: unknown, method: string) {
  const handlers = (
    route as {
      options: {
        server?: { handlers?: Record<string, (...args: never[]) => unknown> }
      }
    }
  ).options.server?.handlers
  const handler = handlers?.[method]
  if (typeof handler !== 'function') {
    throw new Error(`Expected ${method} handler`)
  }
  return handler as (args: {
    context: AppRequestContext
    request: Request
    params: Record<string, string>
    pathname: string
    next: () => { isNext: boolean; context: undefined }
  }) => Promise<Response>
}

/**
 * Builds a request context over the test database. Session and Better Auth's
 * `hasPermission` primitive are stubbed so the test exercises the route,
 * access helpers, and SQL against real rows; the role matrix is driven by
 * `role` instead of a full Better Auth sign-in.
 */
function makeContext(args: {
  testDb: TestDb
  userId: string
  role: FakeRole
  request: Request
}): AppRequestContext {
  return {
    env: {} as AppRequestContext['env'],
    request: args.request,
    db: async () => args.testDb.db,
    close: async () => {},
    auth: {
      getAuth: async () =>
        ({
          api: {
            hasPermission: async () => ({ success: args.role !== 'member' }),
          },
        }) as unknown as Awaited<
          ReturnType<AppRequestContext['auth']['getAuth']>
        >,
      getSession: async () =>
        ({
          user: { id: args.userId },
          session: { activeOrganizationId: null },
        }) as Awaited<ReturnType<AppRequestContext['auth']['getSession']>>,
      getCachedSession: () => undefined,
    },
    waitUntil: () => {},
  }
}

async function seedUser(
  testDb: TestDb,
  workspaceId: string | null,
  role: FakeRole,
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

async function seedWorkspace(testDb: TestDb): Promise<WorkspaceFixture> {
  const workspaceId = randomUUID()
  await testDb.db.insert(schema.organization).values({
    id: workspaceId,
    name: 'Teams test workspace',
    slug: `teams-${workspaceId}`,
  })
  const ownerId = await seedUser(testDb, workspaceId, 'owner')
  const adminId = await seedUser(testDb, workspaceId, 'admin')
  const memberId = await seedUser(testDb, workspaceId, 'member')
  const otherId = await seedUser(testDb, workspaceId, 'member')
  const outsiderId = await seedUser(testDb, null, 'member')
  const activeAgentId = randomUUID()
  const archivedAgentId = randomUUID()
  await testDb.db.insert(schema.agent).values([
    {
      id: activeAgentId,
      workspaceId,
      ownerUserId: ownerId,
      name: 'Active agent',
      status: 'active',
    },
    {
      id: archivedAgentId,
      workspaceId,
      ownerUserId: ownerId,
      name: 'Archived agent',
      status: 'archived',
    },
  ])
  return {
    workspaceId,
    ownerId,
    adminId,
    memberId,
    otherId,
    outsiderId,
    activeAgentId,
    archivedAgentId,
  }
}

async function seedTeamRow(
  testDb: TestDb,
  args: {
    workspaceId: string
    name: string
    ownerUserId: string
    memberUserIds?: string[]
  },
) {
  const teamId = randomUUID()
  await testDb.db.insert(schema.team).values({
    id: teamId,
    workspaceId: args.workspaceId,
    name: args.name,
    ownerUserId: args.ownerUserId,
    createdBy: args.ownerUserId,
  })
  const memberUserIds = [
    args.ownerUserId,
    ...(args.memberUserIds ?? []).filter(
      (userId) => userId !== args.ownerUserId,
    ),
  ]
  await testDb.db.insert(schema.teamMember).values(
    memberUserIds.map((userId) => ({
      id: randomUUID(),
      teamId,
      workspaceId: args.workspaceId,
      userId,
      createdBy: args.ownerUserId,
    })),
  )
  return teamId
}

async function seedTeamIssue(
  testDb: TestDb,
  args: {
    workspaceId: string
    teamId: string
    number: number
    createdBy: string
    assigneeId?: string
  },
) {
  const issueId = randomUUID()
  await testDb.db.insert(schema.issue).values({
    id: issueId,
    workspaceId: args.workspaceId,
    teamId: args.teamId,
    number: args.number,
    title: `Team issue ${args.number}`,
    createdBy: args.createdBy,
    assigneeType: args.assigneeId ? 'user' : null,
    assigneeId: args.assigneeId ?? null,
  })
  return issueId
}

function jsonRequest(
  url: string,
  workspaceId: string,
  method: string,
  body?: unknown,
) {
  return new Request(url, {
    method,
    headers: {
      'X-Workspace-ID': workspaceId,
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

function invocation(
  context: AppRequestContext,
  request: Request,
  params: Record<string, string>,
  pathname: string,
) {
  return {
    context,
    request,
    params,
    pathname,
    next: () => ({ isNext: true as const, context: undefined }),
  }
}

describe('teams API (integration)', () => {
  let testDb: TestDb

  beforeAll(async () => {
    testDb = await startTestDb()
  }, TEST_DB_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await testDb?.cleanup()
  })

  it('rejects Team creation for normal members', async () => {
    const fixture = await seedWorkspace(testDb)
    const request = jsonRequest(
      'https://garden.test/api/teams',
      fixture.workspaceId,
      'POST',
      { name: 'Engineering' },
    )
    const response = await handlerFor(TeamsRoute, 'POST')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.memberId,
          role: 'member',
          request,
        }),
        request,
        {},
        '/api/teams',
      ),
    )
    expect(response.status).toBe(403)
  })

  it('creates a Team with the creator as owner and member', async () => {
    const fixture = await seedWorkspace(testDb)
    const request = jsonRequest(
      'https://garden.test/api/teams',
      fixture.workspaceId,
      'POST',
      { name: 'Engineering', description: 'Builds things' },
    )
    const response = await handlerFor(TeamsRoute, 'POST')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.ownerId,
          role: 'owner',
          request,
        }),
        request,
        {},
        '/api/teams',
      ),
    )
    expect(response.status).toBe(201)
    const team = (await response.json()) as {
      id: string
      name: string
      owner_user_id: string
      member_count: number
      can_manage: boolean
      current_membership: { member_type: string; user_id: string } | null
    }
    expect(team.name).toBe('Engineering')
    expect(team.owner_user_id).toBe(fixture.ownerId)
    expect(team.member_count).toBe(1)
    expect(team.can_manage).toBe(true)
    expect(team.current_membership).toMatchObject({
      member_type: 'user',
      user_id: fixture.ownerId,
    })

    const members = await testDb.db
      .select()
      .from(schema.teamMember)
      .where(eq(schema.teamMember.teamId, team.id))
    expect(members).toHaveLength(1)

    const events = await testDb.db
      .select()
      .from(schema.activityEvent)
      .where(
        and(
          eq(schema.activityEvent.subjectType, 'team'),
          eq(schema.activityEvent.subjectId, team.id),
          eq(schema.activityEvent.eventType, 'team.created'),
        ),
      )
    expect(events).toHaveLength(1)
  })

  it('rejects duplicate names case-insensitively', async () => {
    const fixture = await seedWorkspace(testDb)
    await seedTeamRow(testDb, {
      workspaceId: fixture.workspaceId,
      name: 'Engineering',
      ownerUserId: fixture.ownerId,
    })
    const request = jsonRequest(
      'https://garden.test/api/teams',
      fixture.workspaceId,
      'POST',
      { name: 'engineering' },
    )
    const response = await handlerFor(TeamsRoute, 'POST')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.ownerId,
          role: 'owner',
          request,
        }),
        request,
        {},
        '/api/teams',
      ),
    )
    expect(response.status).toBe(409)
    const body = (await response.json()) as { code: string }
    expect(body.code).toBe('TEAM_NAME_EXISTS')
  })

  it('rolls back creation when a selected member is invalid', async () => {
    const fixture = await seedWorkspace(testDb)
    const request = jsonRequest(
      'https://garden.test/api/teams',
      fixture.workspaceId,
      'POST',
      {
        name: 'Rollback team',
        initial_members: [
          { member_type: 'user', user_id: fixture.outsiderId },
        ],
      },
    )
    const response = await handlerFor(TeamsRoute, 'POST')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.ownerId,
          role: 'owner',
          request,
        }),
        request,
        {},
        '/api/teams',
      ),
    )
    expect(response.status).toBe(400)
    const body = (await response.json()) as { code: string }
    expect(body.code).toBe('INVALID_TEAM_MEMBER')

    const rows = await testDb.db
      .select({ id: schema.team.id })
      .from(schema.team)
      .where(
        and(
          eq(schema.team.workspaceId, fixture.workspaceId),
          eq(schema.team.name, 'Rollback team'),
        ),
      )
    expect(rows).toHaveLength(0)
  })

  it('rejects an explicit owner that initial_members omit', async () => {
    const fixture = await seedWorkspace(testDb)
    const request = jsonRequest(
      'https://garden.test/api/teams',
      fixture.workspaceId,
      'POST',
      {
        name: 'Owner missing team',
        owner_user_id: fixture.adminId,
        initial_members: [
          { member_type: 'user', user_id: fixture.memberId },
        ],
      },
    )
    const response = await handlerFor(TeamsRoute, 'POST')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.ownerId,
          role: 'owner',
          request,
        }),
        request,
        {},
        '/api/teams',
      ),
    )
    expect(response.status).toBe(400)
  })

  it('creates a Team with an active agent member', async () => {
    const fixture = await seedWorkspace(testDb)
    const request = jsonRequest(
      'https://garden.test/api/teams',
      fixture.workspaceId,
      'POST',
      {
        name: 'Agent team',
        initial_members: [
          { member_type: 'agent', agent_id: fixture.activeAgentId },
        ],
      },
    )
    const response = await handlerFor(TeamsRoute, 'POST')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.ownerId,
          role: 'owner',
          request,
        }),
        request,
        {},
        '/api/teams',
      ),
    )
    expect(response.status).toBe(201)
    const team = (await response.json()) as { member_count: number }
    expect(team.member_count).toBe(2)
  })

  it('lists all Teams for managers and only member Teams for members', async () => {
    const fixture = await seedWorkspace(testDb)
    await seedTeamRow(testDb, {
      workspaceId: fixture.workspaceId,
      name: 'Alpha',
      ownerUserId: fixture.ownerId,
      memberUserIds: [fixture.memberId],
    })
    await seedTeamRow(testDb, {
      workspaceId: fixture.workspaceId,
      name: 'Beta',
      ownerUserId: fixture.ownerId,
    })

    const managerRequest = new Request('https://garden.test/api/teams', {
      headers: { 'X-Workspace-ID': fixture.workspaceId },
    })
    const managerResponse = await handlerFor(TeamsRoute, 'GET')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.adminId,
          role: 'admin',
          request: managerRequest,
        }),
        managerRequest,
        {},
        '/api/teams',
      ),
    )
    const managerBody = (await managerResponse.json()) as {
      teams: Array<{ name: string }>
    }
    expect(managerBody.teams.map((team) => team.name).sort()).toEqual([
      'Alpha',
      'Beta',
    ])

    const memberRequest = new Request('https://garden.test/api/teams', {
      headers: { 'X-Workspace-ID': fixture.workspaceId },
    })
    const memberResponse = await handlerFor(TeamsRoute, 'GET')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.memberId,
          role: 'member',
          request: memberRequest,
        }),
        memberRequest,
        {},
        '/api/teams',
      ),
    )
    const memberBody = (await memberResponse.json()) as {
      teams: Array<{ name: string }>
    }
    expect(memberBody.teams.map((team) => team.name)).toEqual(['Alpha'])
  })

  it('scopes issue counts to the caller visibility', async () => {
    const fixture = await seedWorkspace(testDb)
    const teamId = await seedTeamRow(testDb, {
      workspaceId: fixture.workspaceId,
      name: 'Counted',
      ownerUserId: fixture.ownerId,
      memberUserIds: [fixture.memberId],
    })
    await seedTeamIssue(testDb, {
      workspaceId: fixture.workspaceId,
      teamId,
      number: 1,
      createdBy: fixture.ownerId,
      assigneeId: fixture.memberId,
    })
    await seedTeamIssue(testDb, {
      workspaceId: fixture.workspaceId,
      teamId,
      number: 2,
      createdBy: fixture.ownerId,
      assigneeId: fixture.otherId,
    })

    const memberRequest = new Request('https://garden.test/api/teams', {
      headers: { 'X-Workspace-ID': fixture.workspaceId },
    })
    const memberResponse = await handlerFor(TeamsRoute, 'GET')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.memberId,
          role: 'member',
          request: memberRequest,
        }),
        memberRequest,
        {},
        '/api/teams',
      ),
    )
    const memberBody = (await memberResponse.json()) as {
      teams: Array<{ issue_count: number }>
    }
    expect(memberBody.teams[0]?.issue_count).toBe(1)

    const ownerRequest = new Request('https://garden.test/api/teams', {
      headers: { 'X-Workspace-ID': fixture.workspaceId },
    })
    const ownerResponse = await handlerFor(TeamsRoute, 'GET')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.ownerId,
          role: 'owner',
          request: ownerRequest,
        }),
        ownerRequest,
        {},
        '/api/teams',
      ),
    )
    const ownerBody = (await ownerResponse.json()) as {
      teams: Array<{ issue_count: number }>
    }
    expect(ownerBody.teams[0]?.issue_count).toBe(2)
  })

  it('denies Team reads to workspace members outside the Team', async () => {
    const fixture = await seedWorkspace(testDb)
    const teamId = await seedTeamRow(testDb, {
      workspaceId: fixture.workspaceId,
      name: 'Private',
      ownerUserId: fixture.ownerId,
    })
    const request = new Request(`https://garden.test/api/teams/${teamId}`, {
      headers: { 'X-Workspace-ID': fixture.workspaceId },
    })
    const response = await handlerFor(TeamRoute, 'GET')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.otherId,
          role: 'member',
          request,
        }),
        request,
        { teamId },
        '/api/teams/$teamId',
      ),
    )
    expect(response.status).toBe(403)
    const body = (await response.json()) as { code: string }
    expect(body.code).toBe('TEAM_ACCESS_DENIED')
  })

  it('returns 404 for a missing Team', async () => {
    const fixture = await seedWorkspace(testDb)
    const request = new Request(
      `https://garden.test/api/teams/${randomUUID()}`,
      { headers: { 'X-Workspace-ID': fixture.workspaceId } },
    )
    const response = await handlerFor(TeamRoute, 'GET')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.ownerId,
          role: 'owner',
          request,
        }),
        request,
        { teamId: randomUUID() },
        '/api/teams/$teamId',
      ),
    )
    expect(response.status).toBe(404)
    const body = (await response.json()) as { code: string }
    expect(body.code).toBe('TEAM_NOT_FOUND')
  })

  it('lets the Team owner update metadata but not normal members', async () => {
    const fixture = await seedWorkspace(testDb)
    const teamId = await seedTeamRow(testDb, {
      workspaceId: fixture.workspaceId,
      name: 'Editable',
      ownerUserId: fixture.memberId,
      memberUserIds: [fixture.otherId],
    })

    const memberRequest = jsonRequest(
      `https://garden.test/api/teams/${teamId}`,
      fixture.workspaceId,
      'PATCH',
      { name: 'Nope' },
    )
    const memberResponse = await handlerFor(TeamRoute, 'PATCH')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.otherId,
          role: 'member',
          request: memberRequest,
        }),
        memberRequest,
        { teamId },
        '/api/teams/$teamId',
      ),
    )
    expect(memberResponse.status).toBe(403)

    const ownerRequest = jsonRequest(
      `https://garden.test/api/teams/${teamId}`,
      fixture.workspaceId,
      'PATCH',
      { name: 'Renamed', description: 'Updated' },
    )
    const ownerResponse = await handlerFor(TeamRoute, 'PATCH')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.memberId,
          role: 'member',
          request: ownerRequest,
        }),
        ownerRequest,
        { teamId },
        '/api/teams/$teamId',
      ),
    )
    expect(ownerResponse.status).toBe(200)
    const team = (await ownerResponse.json()) as {
      name: string
      can_manage: boolean
      can_transfer_owner: boolean
    }
    expect(team.name).toBe('Renamed')
    expect(team.can_manage).toBe(true)
    expect(team.can_transfer_owner).toBe(false)
  })

  it('adds members, rejects duplicates and archived agents', async () => {
    const fixture = await seedWorkspace(testDb)
    const teamId = await seedTeamRow(testDb, {
      workspaceId: fixture.workspaceId,
      name: 'Growing',
      ownerUserId: fixture.memberId,
    })

    const addRequest = jsonRequest(
      `https://garden.test/api/teams/${teamId}/members`,
      fixture.workspaceId,
      'POST',
      { member_type: 'user', user_id: fixture.otherId },
    )
    const addResponse = await handlerFor(TeamMembersRoute, 'POST')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.memberId,
          role: 'member',
          request: addRequest,
        }),
        addRequest,
        { teamId },
        '/api/teams/$teamId/members',
      ),
    )
    expect(addResponse.status).toBe(201)
    const added = (await addResponse.json()) as {
      member_type: string
      user_id: string
    }
    expect(added).toMatchObject({
      member_type: 'user',
      user_id: fixture.otherId,
    })

    const duplicateRequest = jsonRequest(
      `https://garden.test/api/teams/${teamId}/members`,
      fixture.workspaceId,
      'POST',
      { member_type: 'user', user_id: fixture.otherId },
    )
    const duplicateResponse = await handlerFor(TeamMembersRoute, 'POST')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.memberId,
          role: 'member',
          request: duplicateRequest,
        }),
        duplicateRequest,
        { teamId },
        '/api/teams/$teamId/members',
      ),
    )
    expect(duplicateResponse.status).toBe(409)
    expect(
      ((await duplicateResponse.json()) as { code: string }).code,
    ).toBe('TEAM_MEMBER_EXISTS')

    const archivedRequest = jsonRequest(
      `https://garden.test/api/teams/${teamId}/members`,
      fixture.workspaceId,
      'POST',
      { member_type: 'agent', agent_id: fixture.archivedAgentId },
    )
    const archivedResponse = await handlerFor(TeamMembersRoute, 'POST')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.memberId,
          role: 'member',
          request: archivedRequest,
        }),
        archivedRequest,
        { teamId },
        '/api/teams/$teamId/members',
      ),
    )
    expect(archivedResponse.status).toBe(400)
  })

  it('removes members but blocks removing the owner', async () => {
    const fixture = await seedWorkspace(testDb)
    const teamId = await seedTeamRow(testDb, {
      workspaceId: fixture.workspaceId,
      name: 'Shrinking',
      ownerUserId: fixture.memberId,
      memberUserIds: [fixture.otherId],
    })
    const members = await testDb.db
      .select()
      .from(schema.teamMember)
      .where(eq(schema.teamMember.teamId, teamId))
    const ownerMembership = members.find(
      (row) => row.userId === fixture.memberId,
    )
    const otherMembership = members.find(
      (row) => row.userId === fixture.otherId,
    )

    const removeOtherRequest = new Request(
      `https://garden.test/api/teams/${teamId}/members/${otherMembership?.id}`,
      {
        method: 'DELETE',
        headers: { 'X-Workspace-ID': fixture.workspaceId },
      },
    )
    const removeOtherResponse = await handlerFor(TeamMemberRoute, 'DELETE')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.memberId,
          role: 'member',
          request: removeOtherRequest,
        }),
        removeOtherRequest,
        { teamId, membershipId: otherMembership?.id ?? '' },
        '/api/teams/$teamId/members/$membershipId',
      ),
    )
    expect(removeOtherResponse.status).toBe(204)

    const removeOwnerRequest = new Request(
      `https://garden.test/api/teams/${teamId}/members/${ownerMembership?.id}`,
      {
        method: 'DELETE',
        headers: { 'X-Workspace-ID': fixture.workspaceId },
      },
    )
    const removeOwnerResponse = await handlerFor(TeamMemberRoute, 'DELETE')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.memberId,
          role: 'member',
          request: removeOwnerRequest,
        }),
        removeOwnerRequest,
        { teamId, membershipId: ownerMembership?.id ?? '' },
        '/api/teams/$teamId/members/$membershipId',
      ),
    )
    expect(removeOwnerResponse.status).toBe(409)
    expect(
      ((await removeOwnerResponse.json()) as { code: string }).code,
    ).toBe('TEAM_OWNER_REQUIRES_TRANSFER')
  })

  it('only workspace managers transfer ownership and the target must be a member', async () => {
    const fixture = await seedWorkspace(testDb)
    const teamId = await seedTeamRow(testDb, {
      workspaceId: fixture.workspaceId,
      name: 'Succession',
      ownerUserId: fixture.memberId,
      memberUserIds: [fixture.otherId],
    })

    const ownerAttemptRequest = jsonRequest(
      `https://garden.test/api/teams/${teamId}/owner`,
      fixture.workspaceId,
      'PUT',
      { owner_user_id: fixture.otherId },
    )
    const ownerAttemptResponse = await handlerFor(TeamOwnerRoute, 'PUT')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.memberId,
          role: 'member',
          request: ownerAttemptRequest,
        }),
        ownerAttemptRequest,
        { teamId },
        '/api/teams/$teamId/owner',
      ),
    )
    expect(ownerAttemptResponse.status).toBe(403)

    const invalidTargetRequest = jsonRequest(
      `https://garden.test/api/teams/${teamId}/owner`,
      fixture.workspaceId,
      'PUT',
      { owner_user_id: fixture.adminId },
    )
    const invalidTargetResponse = await handlerFor(TeamOwnerRoute, 'PUT')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.ownerId,
          role: 'owner',
          request: invalidTargetRequest,
        }),
        invalidTargetRequest,
        { teamId },
        '/api/teams/$teamId/owner',
      ),
    )
    expect(invalidTargetResponse.status).toBe(400)

    const transferRequest = jsonRequest(
      `https://garden.test/api/teams/${teamId}/owner`,
      fixture.workspaceId,
      'PUT',
      { owner_user_id: fixture.otherId },
    )
    const transferResponse = await handlerFor(TeamOwnerRoute, 'PUT')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.ownerId,
          role: 'owner',
          request: transferRequest,
        }),
        transferRequest,
        { teamId },
        '/api/teams/$teamId/owner',
      ),
    )
    expect(transferResponse.status).toBe(200)
    const team = (await transferResponse.json()) as { owner_user_id: string }
    expect(team.owner_user_id).toBe(fixture.otherId)
  })

  it('refuses to delete a Team with issues and cascades members on success', async () => {
    const fixture = await seedWorkspace(testDb)
    const linkedTeamId = await seedTeamRow(testDb, {
      workspaceId: fixture.workspaceId,
      name: 'Linked',
      ownerUserId: fixture.ownerId,
    })
    await seedTeamIssue(testDb, {
      workspaceId: fixture.workspaceId,
      teamId: linkedTeamId,
      number: 1,
      createdBy: fixture.ownerId,
    })

    const blockedRequest = new Request(
      `https://garden.test/api/teams/${linkedTeamId}`,
      {
        method: 'DELETE',
        headers: { 'X-Workspace-ID': fixture.workspaceId },
      },
    )
    const blockedResponse = await handlerFor(TeamRoute, 'DELETE')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.ownerId,
          role: 'owner',
          request: blockedRequest,
        }),
        blockedRequest,
        { teamId: linkedTeamId },
        '/api/teams/$teamId',
      ),
    )
    expect(blockedResponse.status).toBe(409)
    expect(((await blockedResponse.json()) as { code: string }).code).toBe(
      'TEAM_HAS_ISSUES',
    )

    const emptyTeamId = await seedTeamRow(testDb, {
      workspaceId: fixture.workspaceId,
      name: 'Disposable',
      ownerUserId: fixture.ownerId,
    })
    const deleteRequest = new Request(
      `https://garden.test/api/teams/${emptyTeamId}`,
      {
        method: 'DELETE',
        headers: { 'X-Workspace-ID': fixture.workspaceId },
      },
    )
    const deleteResponse = await handlerFor(TeamRoute, 'DELETE')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.ownerId,
          role: 'owner',
          request: deleteRequest,
        }),
        deleteRequest,
        { teamId: emptyTeamId },
        '/api/teams/$teamId',
      ),
    )
    expect(deleteResponse.status).toBe(204)

    const remainingMembers = await testDb.db
      .select()
      .from(schema.teamMember)
      .where(eq(schema.teamMember.teamId, emptyTeamId))
    expect(remainingMembers).toHaveLength(0)

    const deleteEvents = await testDb.db
      .select()
      .from(schema.activityEvent)
      .where(
        and(
          eq(schema.activityEvent.subjectType, 'team'),
          eq(schema.activityEvent.subjectId, emptyTeamId),
          eq(schema.activityEvent.eventType, 'team.deleted'),
        ),
      )
    expect(deleteEvents).toHaveLength(1)
    expect(deleteEvents[0]?.payload).toMatchObject({
      name: 'Disposable',
    })
  })

  it('denies Team deletion to Team owners who are not workspace managers', async () => {
    const fixture = await seedWorkspace(testDb)
    const teamId = await seedTeamRow(testDb, {
      workspaceId: fixture.workspaceId,
      name: 'Protected',
      ownerUserId: fixture.memberId,
    })
    const request = new Request(`https://garden.test/api/teams/${teamId}`, {
      method: 'DELETE',
      headers: { 'X-Workspace-ID': fixture.workspaceId },
    })
    const response = await handlerFor(TeamRoute, 'DELETE')(
      invocation(
        makeContext({
          testDb,
          userId: fixture.memberId,
          role: 'member',
          request,
        }),
        request,
        { teamId },
        '/api/teams/$teamId',
      ),
    )
    expect(response.status).toBe(403)
  })
})
