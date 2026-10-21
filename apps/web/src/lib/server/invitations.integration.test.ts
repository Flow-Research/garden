import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as schema from '@garden/db/schema'
import { startTestDb, type TestDb } from '@garden/db/testing'
import { createBetterAuth } from '@/lib/auth/instance'
import { invitationIdFromRedirect } from '@/lib/invitation-flow'
import { acceptInvitationWithSession } from './invitation-acceptance'
import { requireReturnedRow } from './db'

// Match @garden/db's measured testcontainer lifecycle budget. Under the full
// workspace run, concurrent container startup can exceed Vitest's 10s default.
const TEST_DB_HOOK_TIMEOUT_MS = 120_000

const FUTURE = () => new Date(Date.now() + 48 * 3600 * 1000)
const PAST = () => new Date(Date.now() - 3600 * 1000)

type Auth = ReturnType<typeof createBetterAuth>

type SessionContext = {
  requestHeaders: Headers
  session: NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>
}

/**
 * Signs a user up through the real Better Auth instance and captures the
 * session cookies exactly as a browser would send them back. Invitation
 * acceptance depends on those cookies (session lookup + refreshed
 * session_data), so tests must not fabricate session rows by hand.
 */
async function signUpUser(auth: Auth, email: string): Promise<SessionContext> {
  const result = (await auth.api.signUpEmail({
    body: { name: 'Invitee', email, password: 'correct-horse-9' },
    returnHeaders: true,
  })) as { headers: Headers }

  const cookie = result.headers
    .getSetCookie()
    .map((entry) => entry.split(';')[0])
    .join('; ')
  const requestHeaders = new Headers({ cookie })
  const session = await auth.api.getSession({ headers: requestHeaders })
  if (!session) throw new Error('expected a session immediately after sign-up')

  return { requestHeaders, session }
}

async function seedOrganization(testDb: TestDb, suffix: string) {
  const org = requireReturnedRow(
    await testDb.db
      .insert(schema.organization)
      .values({ name: 'Acme', slug: `acme-${suffix}` })
      .returning(),
    'organization',
  )
  const inviter = requireReturnedRow(
    await testDb.db
      .insert(schema.user)
      .values({ email: `inviter-${suffix}@example.com`, name: 'Inviter' })
      .returning(),
    'inviter',
  )

  return { org, inviter }
}

async function seedInvitation(
  testDb: TestDb,
  args: {
    organizationId: string
    inviterId: string
    email: string
    status?: 'pending' | 'accepted' | 'rejected' | 'canceled'
    expiresAt?: Date
  },
) {
  const rows = await testDb.db
    .insert(schema.invitation)
    .values({
      organizationId: args.organizationId,
      inviterId: args.inviterId,
      email: args.email,
      role: 'member',
      status: args.status ?? 'pending',
      expiresAt: args.expiresAt ?? FUTURE(),
    })
    .returning()

  return requireReturnedRow(rows, 'invitation')
}

async function readInvitation(testDb: TestDb, invitationId: string) {
  const [row] = await testDb.db
    .select()
    .from(schema.invitation)
    .where(eq(schema.invitation.id, invitationId))
    .limit(1)
  return row
}

async function readMemberships(
  testDb: TestDb,
  args: { organizationId: string; userId: string },
) {
  return testDb.db
    .select()
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, args.organizationId),
        eq(schema.member.userId, args.userId),
      ),
    )
}

describe('invitation acceptance (integration)', () => {
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

  it('lets a fresh unverified password user accept a valid invite', async () => {
    const suffix = randomUUID()
    const { org, inviter } = await seedOrganization(testDb, suffix)
    const inviteeEmail = `invitee-${suffix}@example.com`
    const invitation = await seedInvitation(testDb, {
      organizationId: org.id,
      inviterId: inviter.id,
      email: inviteeEmail,
    })
    const { requestHeaders, session } = await signUpUser(auth, inviteeEmail)

    // Regression precondition: Garden has no email verification flow, so this
    // is exactly the account state that used to be rejected.
    expect(session.user.emailVerified).toBe(false)

    const result = await acceptInvitationWithSession({
      auth,
      db: testDb.db,
      requestHeaders,
      session,
      invitationId: invitation.id,
    })

    expect(result).toEqual({ status: 'accepted', workspaceId: org.id })
    expect(
      await readMemberships(testDb, {
        organizationId: org.id,
        userId: session.user.id,
      }),
    ).toHaveLength(1)
    expect((await readInvitation(testDb, invitation.id))?.status).toBe(
      'accepted',
    )
  })

  it('keeps repeat acceptance idempotent and activates the workspace', async () => {
    const suffix = randomUUID()
    const { org, inviter } = await seedOrganization(testDb, suffix)
    const inviteeEmail = `invitee-${suffix}@example.com`
    const invitation = await seedInvitation(testDb, {
      organizationId: org.id,
      inviterId: inviter.id,
      email: inviteeEmail,
    })
    const { requestHeaders, session } = await signUpUser(auth, inviteeEmail)

    const first = await acceptInvitationWithSession({
      auth,
      db: testDb.db,
      requestHeaders,
      session,
      invitationId: invitation.id,
    })
    const second = await acceptInvitationWithSession({
      auth,
      db: testDb.db,
      requestHeaders,
      session,
      invitationId: invitation.id,
    })

    expect(first).toEqual({ status: 'accepted', workspaceId: org.id })
    expect(second).toEqual({ status: 'accepted', workspaceId: org.id })
    expect(
      await readMemberships(testDb, {
        organizationId: org.id,
        userId: session.user.id,
      }),
    ).toHaveLength(1)

    const [sessionRow] = await testDb.db
      .select()
      .from(schema.session)
      .where(eq(schema.session.token, session.session.token))
      .limit(1)
    expect(sessionRow?.activeOrganizationId).toBe(org.id)
  })

  it('stops wrong-email sessions without touching the invite', async () => {
    const suffix = randomUUID()
    const { org, inviter } = await seedOrganization(testDb, suffix)
    const invitation = await seedInvitation(testDb, {
      organizationId: org.id,
      inviterId: inviter.id,
      email: `invitee-${suffix}@example.com`,
    })
    const otherEmail = `other-${suffix}@example.com`
    const { requestHeaders, session } = await signUpUser(auth, otherEmail)

    const result = await acceptInvitationWithSession({
      auth,
      db: testDb.db,
      requestHeaders,
      session,
      invitationId: invitation.id,
    })

    expect(result).toEqual({
      status: 'email_mismatch',
      invitationEmail: invitation.email,
      organizationName: 'Acme',
      sessionEmail: otherEmail,
    })
    expect(
      await readMemberships(testDb, {
        organizationId: org.id,
        userId: session.user.id,
      }),
    ).toHaveLength(0)
    expect((await readInvitation(testDb, invitation.id))?.status).toBe(
      'pending',
    )
  })

  it('does not consume another email invite when the user is already a member', async () => {
    const suffix = randomUUID()
    const { org, inviter } = await seedOrganization(testDb, suffix)
    const invitation = await seedInvitation(testDb, {
      organizationId: org.id,
      inviterId: inviter.id,
      email: `invitee-${suffix}@example.com`,
    })
    const otherEmail = `member-${suffix}@example.com`
    const { requestHeaders, session } = await signUpUser(auth, otherEmail)
    await testDb.db.insert(schema.member).values({
      organizationId: org.id,
      userId: session.user.id,
      role: 'member',
    })

    const result = await acceptInvitationWithSession({
      auth,
      db: testDb.db,
      requestHeaders,
      session,
      invitationId: invitation.id,
    })

    expect(result.status).toBe('email_mismatch')
    expect((await readInvitation(testDb, invitation.id))?.status).toBe(
      'pending',
    )
  })

  it.each([
    {
      name: 'expired',
      seed: { expiresAt: PAST() } as const,
      reason: 'expired',
    },
    {
      name: 'canceled',
      seed: { status: 'canceled' } as const,
      reason: 'canceled',
    },
    {
      name: 'rejected',
      seed: { status: 'rejected' } as const,
      reason: 'rejected',
    },
    {
      name: 'accepted without membership',
      seed: { status: 'accepted' } as const,
      reason: 'used',
    },
  ])('marks $name invites unavailable with a distinct reason', async ({
    seed,
    reason,
  }) => {
    const suffix = randomUUID()
    const { org, inviter } = await seedOrganization(testDb, suffix)
    const inviteeEmail = `invitee-${suffix}@example.com`
    const invitation = await seedInvitation(testDb, {
      organizationId: org.id,
      inviterId: inviter.id,
      email: inviteeEmail,
      ...seed,
    })
    const { requestHeaders, session } = await signUpUser(auth, inviteeEmail)

    const result = await acceptInvitationWithSession({
      auth,
      db: testDb.db,
      requestHeaders,
      session,
      invitationId: invitation.id,
    })

    expect(result.status).toBe('unavailable')
    if (result.status === 'unavailable') expect(result.reason).toBe(reason)
    expect(
      await readMemberships(testDb, {
        organizationId: org.id,
        userId: session.user.id,
      }),
    ).toHaveLength(0)
  })

  it('reports unknown invitation ids as not found', async () => {
    const suffix = randomUUID()
    const { requestHeaders, session } = await signUpUser(
      auth,
      `invitee-${suffix}@example.com`,
    )

    const result = await acceptInvitationWithSession({
      auth,
      db: testDb.db,
      requestHeaders,
      session,
      invitationId: randomUUID(),
    })

    expect(result.status).toBe('unavailable')
    if (result.status === 'unavailable') expect(result.reason).toBe('not_found')
  })

  it('maps Better Auth membership-limit failures to workspace_full', async () => {
    const suffix = randomUUID()
    const { org, inviter } = await seedOrganization(testDb, suffix)

    // Better Auth's default membershipLimit is 100 (crud-invites.mjs).
    const fillerUsers = await testDb.db
      .insert(schema.user)
      .values(
        Array.from({ length: 100 }, (_, index) => ({
          email: `filler-${suffix}-${index}@example.com`,
          name: 'Filler',
        })),
      )
      .returning()
    await testDb.db.insert(schema.member).values(
      fillerUsers.map((filler) => ({
        organizationId: org.id,
        userId: filler.id,
        role: 'member',
      })),
    )

    const inviteeEmail = `invitee-${suffix}@example.com`
    const invitation = await seedInvitation(testDb, {
      organizationId: org.id,
      inviterId: inviter.id,
      email: inviteeEmail,
    })
    const { requestHeaders, session } = await signUpUser(auth, inviteeEmail)

    const result = await acceptInvitationWithSession({
      auth,
      db: testDb.db,
      requestHeaders,
      session,
      invitationId: invitation.id,
    })

    expect(result.status).toBe('unavailable')
    if (result.status === 'unavailable') {
      expect(result.reason).toBe('workspace_full')
    }
  })

  it('never resurrects a concurrently canceled invite during recovery', async () => {
    const suffix = randomUUID()
    const { org, inviter } = await seedOrganization(testDb, suffix)
    const inviteeEmail = `invitee-${suffix}@example.com`
    const { requestHeaders, session } = await signUpUser(auth, inviteeEmail)

    // Race fixture: membership exists (accept landed) but a cancel already
    // flipped the invite out of pending before the recovery path ran.
    await testDb.db.insert(schema.member).values({
      organizationId: org.id,
      userId: session.user.id,
      role: 'member',
    })
    const invitation = await seedInvitation(testDb, {
      organizationId: org.id,
      inviterId: inviter.id,
      email: inviteeEmail,
      status: 'canceled',
    })

    const result = await acceptInvitationWithSession({
      auth,
      db: testDb.db,
      requestHeaders,
      session,
      invitationId: invitation.id,
    })

    expect(result).toEqual({ status: 'accepted', workspaceId: org.id })
    expect((await readInvitation(testDb, invitation.id))?.status).toBe(
      'canceled',
    )
  })
})

describe('invitationIdFromRedirect', () => {
  it('extracts uuid ids from invite redirects', () => {
    const id = randomUUID()
    expect(invitationIdFromRedirect(`/invitations/${id}`)).toBe(id)
  })

  it.each([
    ['relative garbage', '/invitations/not-a-uuid'],
    ['external url', 'https://evil.example/invitations/x'],
    ['backslash external url', `/\\evil.example/invitations/${randomUUID()}`],
    ['missing id', '/invitations/'],
    ['undefined', undefined],
  ])('rejects %s', (_name, target) => {
    expect(invitationIdFromRedirect(target)).toBeNull()
  })
})
