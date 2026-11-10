import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import * as schema from '@garden/db/schema'
import { startTestDb, type TestDb } from '@garden/db/testing'
import { createBetterAuth } from '@/lib/auth/instance'
import type { AppRequestContext } from '@/lib/server/context'
import { acceptInvitationWithSession } from '@/lib/server/invitation-acceptance'
import { invokeRouteHandler } from '@/test/route-handler'
import { Route as MembersRoute } from './members'
import { Route as TeamSettingsRoute } from './team-settings'
import { Route as TeamsRoute } from '../../teams'

const TEST_DB_HOOK_TIMEOUT_MS = 120_000

const mocks = vi.hoisted(() => ({
  sendOrganizationInvitationEmail: vi.fn(),
}))

vi.mock('@/lib/server/email/invitation', () => ({
  sendOrganizationInvitationEmail: mocks.sendOrganizationInvitationEmail,
}))

type Auth = ReturnType<typeof createBetterAuth>

type SignedInUser = {
  id: string
  email: string
  headers: Headers
}

/**
 * Signs a user up through the real Better Auth instance so invite creation,
 * permission checks, and acceptance all run against real sessions and rows.
 */
async function signUp(auth: Auth, email: string): Promise<SignedInUser> {
  const result = (await auth.api.signUpEmail({
    body: { name: email, email, password: 'correct-horse-9' },
    returnHeaders: true,
  })) as { headers: Headers }
  const cookie = result.headers
    .getSetCookie()
    .map((entry) => entry.split(';')[0])
    .join('; ')
  const headers = new Headers({ cookie })
  const session = await auth.api.getSession({ headers })
  if (!session) throw new Error('expected a session after sign-up')
  return { id: session.user.id, email, headers }
}

describe('invitation Teams (integration)', () => {
  let testDb: TestDb
  let auth: Auth

  beforeAll(async () => {
    testDb = await startTestDb()
    auth = createBetterAuth(testDb.db, {
      BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret',
      BETTER_AUTH_URL: 'http://localhost:3000',
    } as Parameters<typeof createBetterAuth>[1])
  }, TEST_DB_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await testDb?.cleanup()
  }, TEST_DB_HOOK_TIMEOUT_MS)

  beforeEach(() => {
    mocks.sendOrganizationInvitationEmail.mockReset()
    mocks.sendOrganizationInvitationEmail.mockResolvedValue(undefined)
  })

  function contextFor(user: SignedInUser, request: Request): AppRequestContext {
    return {
      env: {} as AppRequestContext['env'],
      request,
      db: async () => testDb.db,
      close: async () => {},
      auth: {
        getAuth: async () => auth,
        getSession: async () => auth.api.getSession({ headers: user.headers }),
        getCachedSession: () => undefined,
      },
      waitUntil: () => {},
    }
  }

  function request(
    user: SignedInUser,
    workspaceId: string,
    path: string,
    method: string,
    body?: unknown,
  ) {
    const headers = new Headers(user.headers)
    headers.set('X-Workspace-ID', workspaceId)
    headers.set('content-type', 'application/json')
    return new Request(`http://localhost:3000${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }

  async function addMember(
    workspaceId: string,
    user: SignedInUser,
    role: 'owner' | 'admin' | 'member',
  ) {
    await testDb.db
      .insert(schema.member)
      .values({ organizationId: workspaceId, userId: user.id, role })
  }

  async function seedTeam(
    workspaceId: string,
    owner: SignedInUser,
    name: string,
  ) {
    const teamId = randomUUID()
    await testDb.db.insert(schema.team).values({
      id: teamId,
      workspaceId,
      name,
      ownerUserId: owner.id,
      createdBy: owner.id,
    })
    await testDb.db.insert(schema.teamMember).values({
      teamId,
      workspaceId,
      userId: owner.id,
      createdBy: owner.id,
    })
    return teamId
  }

  /**
   * One workspace with an owner, an admin, a Team owner who is a plain
   * workspace member, and a plain member, plus two Teams: Engineering owned
   * by the Team owner and Finance owned by the workspace owner.
   */
  async function seedWorkspace() {
    const suffix = randomUUID()
    const workspaceId = randomUUID()
    await testDb.db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Acme',
      slug: `acme-${suffix}`,
    })
    const owner = await signUp(auth, `owner-${suffix}@example.com`)
    const admin = await signUp(auth, `admin-${suffix}@example.com`)
    const teamOwner = await signUp(auth, `lead-${suffix}@example.com`)
    const plain = await signUp(auth, `plain-${suffix}@example.com`)
    await addMember(workspaceId, owner, 'owner')
    await addMember(workspaceId, admin, 'admin')
    await addMember(workspaceId, teamOwner, 'member')
    await addMember(workspaceId, plain, 'member')
    const engineeringId = await seedTeam(workspaceId, teamOwner, 'Engineering')
    const financeId = await seedTeam(workspaceId, owner, 'Finance')
    return {
      suffix,
      workspaceId,
      owner,
      admin,
      teamOwner,
      plain,
      engineeringId,
      financeId,
    }
  }

  async function invite(
    inviter: SignedInUser,
    workspaceId: string,
    body: Record<string, unknown>,
  ) {
    const req = request(
      inviter,
      workspaceId,
      `/api/workspaces/${workspaceId}/members`,
      'POST',
      body,
    )
    return invokeRouteHandler(MembersRoute, 'POST', {
      context: contextFor(inviter, req),
      request: req,
      params: { id: workspaceId },
    })
  }

  async function invitationTeamIds(invitationId: string) {
    const rows = await testDb.db
      .select({ teamId: schema.invitationTeam.teamId })
      .from(schema.invitationTeam)
      .where(eq(schema.invitationTeam.invitationId, invitationId))
    return rows.map((row) => row.teamId).sort()
  }

  async function teamMemberships(teamId: string, userId: string) {
    return testDb.db
      .select()
      .from(schema.teamMember)
      .where(
        and(
          eq(schema.teamMember.teamId, teamId),
          eq(schema.teamMember.userId, userId),
        ),
      )
  }

  async function accept(invitee: SignedInUser, invitationId: string) {
    const session = await auth.api.getSession({ headers: invitee.headers })
    if (!session) throw new Error('expected invitee session')
    return acceptInvitationWithSession({
      auth,
      db: testDb.db,
      requestHeaders: invitee.headers,
      session,
      invitationId,
    })
  }

  async function updateSettings(
    actor: SignedInUser,
    workspaceId: string,
    body: Record<string, unknown>,
  ) {
    const req = request(
      actor,
      workspaceId,
      `/api/workspaces/${workspaceId}/team-settings`,
      'PATCH',
      body,
    )
    return invokeRouteHandler(TeamSettingsRoute, 'PATCH', {
      context: contextFor(actor, req),
      request: req,
      params: { id: workspaceId },
    })
  }

  it('adds an accepted invitee to the invited Team and its board', async () => {
    const ws = await seedWorkspace()
    const email = `new-${ws.suffix}@example.com`

    const response = await invite(ws.owner, ws.workspaceId, {
      email,
      team_ids: [ws.engineeringId],
    })
    expect(response.status).toBe(200)
    const invitation = (await response.json()) as { id: string }
    expect(await invitationTeamIds(invitation.id)).toEqual([ws.engineeringId])

    const invitee = await signUp(auth, email)
    expect(await accept(invitee, invitation.id)).toEqual({
      status: 'accepted',
      workspaceId: ws.workspaceId,
    })
    expect(await teamMemberships(ws.engineeringId, invitee.id)).toHaveLength(1)

    const teamsRequest = request(invitee, ws.workspaceId, '/api/teams', 'GET')
    const teamsResponse = await invokeRouteHandler(TeamsRoute, 'GET', {
      context: contextFor(invitee, teamsRequest),
      request: teamsRequest,
    })
    const body = (await teamsResponse.json()) as {
      teams: Array<{ id: string }>
    }
    expect(body.teams.map((team) => team.id)).toEqual([ws.engineeringId])
  })

  it('keeps repeat acceptance idempotent for Team rows', async () => {
    const ws = await seedWorkspace()
    const email = `new-${ws.suffix}@example.com`
    const response = await invite(ws.admin, ws.workspaceId, {
      email,
      team_ids: [ws.engineeringId, ws.financeId],
    })
    const invitation = (await response.json()) as { id: string }
    const invitee = await signUp(auth, email)

    const first = await accept(invitee, invitation.id)
    const second = await accept(invitee, invitation.id)

    expect(first.status).toBe('accepted')
    expect(second.status).toBe('accepted')
    expect(await teamMemberships(ws.engineeringId, invitee.id)).toHaveLength(1)
    expect(await teamMemberships(ws.financeId, invitee.id)).toHaveLength(1)
  })

  it('adds the Team when workspace membership already existed', async () => {
    const ws = await seedWorkspace()
    const email = `new-${ws.suffix}@example.com`
    const response = await invite(ws.owner, ws.workspaceId, {
      email,
      team_ids: [ws.engineeringId],
    })
    const invitation = (await response.json()) as { id: string }
    const invitee = await signUp(auth, email)
    await addMember(ws.workspaceId, invitee, 'member')

    expect((await accept(invitee, invitation.id)).status).toBe('accepted')
    expect(await teamMemberships(ws.engineeringId, invitee.id)).toHaveLength(1)
  })

  it('lets a Team owner invite into their own Team while the setting is on', async () => {
    const ws = await seedWorkspace()
    const email = `new-${ws.suffix}@example.com`

    const response = await invite(ws.teamOwner, ws.workspaceId, {
      email,
      team_ids: [ws.engineeringId],
    })

    expect(response.status).toBe(200)
    const invitation = (await response.json()) as { id: string }
    expect(await invitationTeamIds(invitation.id)).toEqual([ws.engineeringId])
    const invitee = await signUp(auth, email)
    expect((await accept(invitee, invitation.id)).status).toBe('accepted')
    expect(await teamMemberships(ws.engineeringId, invitee.id)).toHaveLength(1)
  })

  it('refuses Team owner invites when the setting is off', async () => {
    const ws = await seedWorkspace()
    expect(
      (
        await updateSettings(ws.owner, ws.workspaceId, {
          team_owners_can_invite: false,
        })
      ).status,
    ).toBe(200)

    const response = await invite(ws.teamOwner, ws.workspaceId, {
      email: `new-${ws.suffix}@example.com`,
      team_ids: [ws.engineeringId],
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      code: 'TEAM_OWNER_INVITES_DISABLED',
    })
  })

  it('refuses a Team owner attaching a Team they do not own', async () => {
    const ws = await seedWorkspace()
    const response = await invite(ws.teamOwner, ws.workspaceId, {
      email: `new-${ws.suffix}@example.com`,
      team_ids: [ws.engineeringId, ws.financeId],
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      code: 'INVITATION_TEAM_FORBIDDEN',
    })
  })

  it('refuses a plain member', async () => {
    const ws = await seedWorkspace()
    const withTeam = await invite(ws.plain, ws.workspaceId, {
      email: `new-${ws.suffix}@example.com`,
      team_ids: [ws.engineeringId],
    })
    const withoutTeam = await invite(ws.plain, ws.workspaceId, {
      email: `other-${ws.suffix}@example.com`,
    })

    expect(withTeam.status).toBe(403)
    expect(await withTeam.json()).toMatchObject({
      code: 'INVITATION_TEAM_FORBIDDEN',
    })
    expect(withoutTeam.status).toBe(403)
  })

  it('rejects a Team from another workspace', async () => {
    const ws = await seedWorkspace()
    const other = await seedWorkspace()
    const response = await invite(ws.owner, ws.workspaceId, {
      email: `new-${ws.suffix}@example.com`,
      team_ids: [other.engineeringId],
    })

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: 'TEAM_NOT_FOUND' })
    const pending = await testDb.db
      .select()
      .from(schema.invitation)
      .where(eq(schema.invitation.organizationId, ws.workspaceId))
    expect(pending).toHaveLength(0)
  })

  it('attaches the default Team when the invite names none', async () => {
    const ws = await seedWorkspace()
    expect(
      (
        await updateSettings(ws.admin, ws.workspaceId, {
          default_team_id: ws.financeId,
        })
      ).status,
    ).toBe(200)
    const email = `new-${ws.suffix}@example.com`

    const response = await invite(ws.owner, ws.workspaceId, { email })
    const invitation = (await response.json()) as { id: string }
    const invitee = await signUp(auth, email)
    await accept(invitee, invitation.id)

    expect(await teamMemberships(ws.financeId, invitee.id)).toHaveLength(1)
    expect(await teamMemberships(ws.engineeringId, invitee.id)).toHaveLength(0)
  })

  it('joins no Team when no default is set and none is named', async () => {
    const ws = await seedWorkspace()
    const email = `new-${ws.suffix}@example.com`

    const response = await invite(ws.owner, ws.workspaceId, { email })
    const invitation = (await response.json()) as { id: string }
    expect(await invitationTeamIds(invitation.id)).toEqual([])
    const invitee = await signUp(auth, email)
    await accept(invitee, invitation.id)

    const rows = await testDb.db
      .select()
      .from(schema.teamMember)
      .where(eq(schema.teamMember.userId, invitee.id))
    expect(rows).toHaveLength(0)
  })

  it('cancels the invite and drops its Team rows when the email fails', async () => {
    const ws = await seedWorkspace()
    mocks.sendOrganizationInvitationEmail.mockRejectedValue(
      new Error('Resend down'),
    )

    const response = await invite(ws.owner, ws.workspaceId, {
      email: `new-${ws.suffix}@example.com`,
      team_ids: [ws.engineeringId],
    })

    expect(response.status).toBe(502)
    const rows = await testDb.db
      .select({ status: schema.invitation.status })
      .from(schema.invitation)
      .where(eq(schema.invitation.organizationId, ws.workspaceId))
    expect(rows.map((row) => row.status)).toEqual(['canceled'])
    const teamRows = await testDb.db
      .select()
      .from(schema.invitationTeam)
      .where(eq(schema.invitationTeam.workspaceId, ws.workspaceId))
    expect(teamRows).toHaveLength(0)
  })

  it('lets owners and admins change invite settings and refuses members', async () => {
    const ws = await seedWorkspace()
    const other = await seedWorkspace()

    const adminResponse = await updateSettings(ws.admin, ws.workspaceId, {
      team_owners_can_invite: false,
      default_team_id: ws.engineeringId,
    })
    expect(adminResponse.status).toBe(200)
    expect(await adminResponse.json()).toEqual({
      team_owners_can_invite: false,
      default_team_id: ws.engineeringId,
    })

    const memberResponse = await updateSettings(ws.plain, ws.workspaceId, {
      team_owners_can_invite: true,
    })
    expect(memberResponse.status).toBe(403)

    const foreignResponse = await updateSettings(ws.owner, ws.workspaceId, {
      default_team_id: other.financeId,
    })
    expect(foreignResponse.status).toBe(404)
    expect(await foreignResponse.json()).toMatchObject({
      code: 'TEAM_NOT_FOUND',
    })

    const clearResponse = await updateSettings(ws.owner, ws.workspaceId, {
      default_team_id: null,
    })
    expect(await clearResponse.json()).toEqual({
      team_owners_can_invite: false,
      default_team_id: null,
    })

    const readRequest = request(
      ws.plain,
      ws.workspaceId,
      `/api/workspaces/${ws.workspaceId}/team-settings`,
      'GET',
    )
    const readResponse = await invokeRouteHandler(TeamSettingsRoute, 'GET', {
      context: contextFor(ws.plain, readRequest),
      request: readRequest,
      params: { id: ws.workspaceId },
    })
    expect(readResponse.status).toBe(200)
  })
})
