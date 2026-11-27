import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as schema from '@garden/db/schema'
import { startTestDb, type TestDb } from '@garden/db/testing'
import { createBetterAuth } from '@/lib/auth/instance'
import type { AppRequestContext } from '@/lib/server/context'
import { invokeRouteHandler } from '@/test/route-handler'
import { Route } from './notification-preferences'

const TEST_DB_HOOK_TIMEOUT_MS = 120_000

type Auth = ReturnType<typeof createBetterAuth>
type SignedInUser = { id: string; headers: Headers }

/** Real Better Auth sessions, so the route resolves identity from cookies. */
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
  return { id: session.user.id, headers }
}

describe('notification preferences route (integration)', () => {
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

  function call(
    user: SignedInUser | null,
    workspaceId: string,
    method: 'GET' | 'PATCH',
    body?: unknown,
  ) {
    const headers = new Headers(user?.headers)
    headers.set('content-type', 'application/json')
    const request = new Request(
      `http://localhost:3000/api/workspaces/${workspaceId}/notification-preferences`,
      {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    )
    const context: AppRequestContext = {
      env: {} as AppRequestContext['env'],
      request,
      db: async () => testDb.db,
      close: async () => {},
      auth: {
        getAuth: async () => auth,
        getSession: async () =>
          user ? auth.api.getSession({ headers: user.headers }) : null,
        getCachedSession: () => undefined,
      },
      waitUntil: () => {},
    }
    return invokeRouteHandler(Route, method, {
      context,
      request,
      params: { id: workspaceId },
    })
  }

  async function seed() {
    const suffix = randomUUID()
    const workspaceId = randomUUID()
    const otherWorkspaceId = randomUUID()
    await testDb.db.insert(schema.organization).values([
      { id: workspaceId, name: 'Acme', slug: `acme-${suffix}` },
      { id: otherWorkspaceId, name: 'Other', slug: `other-${suffix}` },
    ])
    const owner = await signUp(auth, `owner-${suffix}@example.com`)
    const member = await signUp(auth, `member-${suffix}@example.com`)
    const outsider = await signUp(auth, `outsider-${suffix}@example.com`)
    await testDb.db.insert(schema.member).values([
      { organizationId: workspaceId, userId: owner.id, role: 'owner' },
      { organizationId: workspaceId, userId: member.id, role: 'member' },
      { organizationId: otherWorkspaceId, userId: member.id, role: 'member' },
    ])
    return { workspaceId, otherWorkspaceId, owner, member, outsider }
  }

  const storedPreferences = async (workspaceId: string, userId: string) => {
    const [row] = await testDb.db
      .select({ value: schema.member.notificationPreferences })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, workspaceId),
          eq(schema.member.userId, userId),
        ),
      )
    return row?.value
  }

  it('returns all four email toggles on for a new member', async () => {
    const { workspaceId, member } = await seed()
    const response = await call(member, workspaceId, 'GET')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      preferences: [
        { category: 'mentions', channels: { email: true } },
        { category: 'assignments', channels: { email: true } },
        { category: 'approvals', channels: { email: true } },
        { category: 'input_requests', channels: { email: true } },
      ],
    })
  })

  it('changes only the session member in the addressed workspace', async () => {
    const { workspaceId, otherWorkspaceId, owner, member } = await seed()
    const response = await call(member, workspaceId, 'PATCH', {
      category: 'approvals',
      channel: 'email',
      enabled: false,
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      preferences: expect.arrayContaining([
        { category: 'approvals', channels: { email: false } },
        { category: 'mentions', channels: { email: true } },
      ]),
    })
    expect(await storedPreferences(workspaceId, member.id)).toEqual({
      approvals: { email: false },
    })
    expect(await storedPreferences(workspaceId, owner.id)).toEqual({})
    expect(await storedPreferences(otherWorkspaceId, member.id)).toEqual({})
  })

  it('keeps other categories when two toggles are saved concurrently', async () => {
    const { workspaceId, member } = await seed()
    const responses = await Promise.all(
      (['mentions', 'assignments', 'input_requests'] as const).map((category) =>
        call(member, workspaceId, 'PATCH', {
          category,
          channel: 'email',
          enabled: false,
        }),
      ),
    )
    expect(responses.map((response) => response.status)).toEqual([
      200, 200, 200,
    ])
    expect(await storedPreferences(workspaceId, member.id)).toEqual({
      mentions: { email: false },
      assignments: { email: false },
      input_requests: { email: false },
    })
  })

  it('rejects a body that names another member or an unknown category', async () => {
    const { workspaceId, owner, member } = await seed()
    for (const body of [
      {
        category: 'mentions',
        channel: 'email',
        enabled: false,
        user_id: owner.id,
      },
      { category: 'comments', channel: 'email', enabled: false },
      { category: 'mentions', channel: 'discord', enabled: false },
    ]) {
      const response = await call(member, workspaceId, 'PATCH', body)
      expect(response.status).toBe(400)
    }
    expect(await storedPreferences(workspaceId, owner.id)).toEqual({})
    expect(await storedPreferences(workspaceId, member.id)).toEqual({})
  })

  it('refuses signed-out callers and users outside the workspace', async () => {
    const { workspaceId, outsider } = await seed()
    expect((await call(null, workspaceId, 'GET')).status).toBe(401)
    expect((await call(outsider, workspaceId, 'GET')).status).toBe(403)
    expect(
      (
        await call(outsider, workspaceId, 'PATCH', {
          category: 'mentions',
          channel: 'email',
          enabled: false,
        })
      ).status,
    ).toBe(403)
  })
})
