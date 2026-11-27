// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { startTestDb, type TestDb } from '@garden/db/testing'
import * as schema from '@garden/db/schema'
import {
  hostContractVersion,
  hostDirectorySchema,
  hostOutcomeSchema,
  hostSnapshotSchema,
  launchReceiptSchema,
  type HostEnrollment,
  type HostLaunch,
  type HostRequestUnsigned,
} from '@garden/core/execution-host/contracts'
import { signHostRequest } from '@garden/core/execution-host/auth'
import { executionControlDigest } from '@garden/server/execution-hosts'
import { createBetterAuth } from '@/lib/auth/instance'
import { createAppRequestContext, type AppRequestContext } from './context'
import type { AppEnv } from './env'
import {
  handleExecutionHostAction,
  handleExecutionHostDirectory,
  handleExecutionHostRun,
} from './execution-hosts'

const ORIGIN = 'https://garden.test'
const SECRET = 'execution-host-http-fixture-secret-over-32-characters'
const contexts: AppRequestContext[] = []
let database: TestDb

function context(request: Request, operatorId?: string): AppRequestContext {
  const env = {
    DATABASE_URL: database.databaseUrl,
    HYPERDRIVE: { connectionString: database.databaseUrl },
    BETTER_AUTH_SECRET: SECRET,
    BETTER_AUTH_URL: ORIGIN,
    ENVIRONMENT: 'test',
    ENGINEERING_PILOT_OPERATOR_ID: operatorId,
  } as AppEnv
  const requestContext = createAppRequestContext(env, request)
  contexts.push(requestContext)
  return requestContext
}

function cookieHeader(previous: string, headers: Headers): string {
  const cookies = new Map(
    previous
      .split('; ')
      .filter(Boolean)
      .map((value) => {
        const split = value.indexOf('=')
        return [value.slice(0, split), value.slice(split + 1)]
      }),
  )
  for (const entry of headers.getSetCookie()) {
    const pair = entry.split(';')[0]
    if (pair === undefined)
      throw new Error('Expected a Set-Cookie name/value pair')
    const split = pair.indexOf('=')
    cookies.set(pair.slice(0, split), pair.slice(split + 1))
  }
  return [...cookies].map(([key, value]) => `${key}=${value}`).join('; ')
}

async function launchInput(
  enrollment: HostEnrollment,
  lifetimeMs: number,
): Promise<HostLaunch> {
  const issuedAt = Date.now()
  const job: HostLaunch['job'] = {
    schema: 'harnessy.engineering.job.v1',
    id: randomUUID(),
    objective: 'http-host-authority',
    taskId: randomUUID(),
    taskRevision: 'a'.repeat(64),
    workspace: enrollment.workspaceId,
    repository: 'garden',
    lane: 'native',
    sourceRevision: 'b'.repeat(40),
    evaluatorDigest: 'c'.repeat(64),
    workloadDigest: 'd'.repeat(64),
  }
  const unsigned = {
    contractVersion: hostContractVersion,
    launchId: randomUUID(),
    hostId: enrollment.hostId,
    workspaceId: enrollment.workspaceId,
    memberId: enrollment.operatorId,
    operatorId: enrollment.operatorId,
    capabilityDigest: enrollment.capabilityDigest,
    job,
    grant: {
      schema: 'harnessy.engineering.grant.v1' as const,
      id: randomUUID(),
      operator: 'julian' as const,
      jobDigest: await executionControlDigest(job),
      issuedAt,
      expiresAt: issuedAt + lifetimeMs,
    },
  }
  return { ...unsigned, requestDigest: await executionControlDigest(unsigned) }
}

async function fixture(rememberMe = true) {
  const auth = createBetterAuth(database.db, {
    BETTER_AUTH_SECRET: SECRET,
    BETTER_AUTH_URL: ORIGIN,
    RESEND_API_KEY: undefined,
    authMode: 'session',
  })
  const signedUp = await auth.api.signUpEmail({
    body: {
      name: 'HTTP pilot fixture',
      email: `${randomUUID()}@example.test`,
      password: 'local-fixture-password-9',
      rememberMe,
    },
    returnHeaders: true,
  })
  let cookie = cookieHeader('', signedUp.headers)
  const initial = await auth.api.getSession({
    headers: new Headers({ cookie }),
  })
  if (!initial)
    throw new Error('Real Better Auth signup did not create a session')
  const operatorId = initial.user.id
  const workspaceId = randomUUID()
  const secondWorkspaceId = randomUUID()
  await database.db.insert(schema.organization).values([
    { id: workspaceId, name: 'HTTP pilot', slug: `http-${workspaceId}` },
    {
      id: secondWorkspaceId,
      name: 'Second workspace',
      slug: `http-${secondWorkspaceId}`,
    },
  ])
  await database.db.insert(schema.member).values([
    { organizationId: workspaceId, userId: operatorId, role: 'owner' },
    { organizationId: secondWorkspaceId, userId: operatorId, role: 'owner' },
  ])
  const active = await auth.api.setActiveOrganization({
    headers: new Headers({ cookie, origin: ORIGIN }),
    body: { organizationId: workspaceId },
    returnHeaders: true,
  })
  cookie = cookieHeader(cookie, active.headers)
  const cached = await auth.api.getSession({
    headers: new Headers({ cookie }),
    returnHeaders: true,
  })
  cookie = cookieHeader(cookie, cached.headers)
  if (!cached.response)
    throw new Error('Real Better Auth active session disappeared')
  expect(cached.response.session.activeOrganizationId).toBe(workspaceId)
  expect(cookie).toContain('session_data')
  const keys = await crypto.subtle.generateKey('Ed25519', true, [
    'sign',
    'verify',
  ])
  if (!('privateKey' in keys))
    throw new Error('Expected an actual Ed25519 key pair')
  const enrollment: HostEnrollment = {
    contractVersion: hostContractVersion,
    hostId: randomUUID(),
    workspaceId,
    operatorId,
    publicKey: Buffer.from(
      await crypto.subtle.exportKey('raw', keys.publicKey),
    ).toString('base64url'),
    keyGeneration: 1,
    repositories: ['garden'],
    agent: 'claude-code',
    capabilityDigest: 'a'.repeat(64),
  }
  const request = (
    body: unknown = enrollment,
    options: { origin?: string | null; workspace?: string | null } = {},
  ) => {
    const headers = new Headers({ cookie, 'content-type': 'application/json' })
    const origin = options.origin === undefined ? ORIGIN : options.origin
    const workspace =
      options.workspace === undefined ? workspaceId : options.workspace
    if (origin !== null) headers.set('origin', origin)
    if (workspace !== null) headers.set('X-Workspace-ID', workspace)
    return new Request(`${ORIGIN}/api/execution-hosts/enroll`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
  }
  const directoryRequest = (
    workspace: string | null = workspaceId,
    afterHostId?: string,
  ) => {
    const headers = new Headers({ cookie })
    if (workspace !== null) headers.set('X-Workspace-ID', workspace)
    const url = new URL(`${ORIGIN}/api/execution-hosts/`)
    if (afterHostId !== undefined)
      url.searchParams.set('afterHostId', afterHostId)
    return new Request(url, { headers })
  }
  return {
    auth,
    cookie,
    operatorId,
    workspaceId,
    secondWorkspaceId,
    enrollment,
    keys,
    request,
    directoryRequest,
    sessionId: cached.response.session.id,
  }
}

beforeAll(async () => {
  database = await startTestDb()
}, 120_000)
afterEach(async () => {
  await Promise.all(contexts.splice(0).map((entry) => entry.close()))
})
afterAll(async () => {
  await database?.cleanup()
}, 120_000)

describe('execution-host HTTP authority with actual Better Auth and PostgreSQL', () => {
  it('enrolls using the real session, explicit workspace, and current owner permission', async () => {
    const state = await fixture()
    const response = await handleExecutionHostAction(
      context(state.request(), state.operatorId),
      'enroll',
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toMatchObject({
      kind: 'enrolled',
      enrollment: { hostId: state.enrollment.hostId },
    })
    const rows = await database.db
      .select()
      .from(schema.executionHost)
      .where(eq(schema.executionHost.id, state.enrollment.hostId))
    expect(rows).toHaveLength(1)
  })

  it('refuses a deleted session even while its real signed cookie cache remains valid', async () => {
    const state = await fixture()
    await database.db
      .delete(schema.session)
      .where(eq(schema.session.id, state.sessionId))
    const stillCached = await state.auth.api.getSession({
      headers: new Headers({ cookie: state.cookie }),
    })
    expect(stillCached?.user.id).toBe(state.operatorId)
    const response = await handleExecutionHostAction(
      context(state.request(), state.operatorId),
      'enroll',
    )
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ error: 'Unauthorized' })
    expect(
      await database.db
        .select()
        .from(schema.executionHost)
        .where(eq(schema.executionHost.id, state.enrollment.hostId)),
    ).toHaveLength(0)
  })

  it('refuses absent sessions and current membership loss', async () => {
    const state = await fixture()
    const missing = state.request()
    missing.headers.delete('cookie')
    expect(
      (
        await handleExecutionHostAction(
          context(missing, state.operatorId),
          'enroll',
        )
      ).status,
    ).toBe(401)
    await database.db
      .delete(schema.member)
      .where(eq(schema.member.userId, state.operatorId))
    const revoked = await handleExecutionHostAction(
      context(state.request(), state.operatorId),
      'enroll',
    )
    expect(revoked.status).toBe(401)
    expect(await revoked.json()).toMatchObject({ error: 'Unauthorized' })
  })

  it('refuses enrollment, launch, and cancellation when the pilot owner becomes an ordinary member during admission', async () => {
    const state = await fixture()
    expect(
      (
        await handleExecutionHostAction(
          context(state.request(), state.operatorId),
          'enroll',
        )
      ).status,
    ).toBe(200)
    const original = await launchInput(state.enrollment, 60_000)
    expect(
      (
        await handleExecutionHostAction(
          context(state.request(original), state.operatorId),
          'launch',
        )
      ).status,
    ).toBe(200)
    const replacement = await launchInput(state.enrollment, 60_000)
    const extraEnrollment = { ...state.enrollment, hostId: randomUUID() }
    const requests = () => [
      handleExecutionHostAction(
        context(state.request(extraEnrollment), state.operatorId),
        'enroll',
      ),
      handleExecutionHostAction(
        context(state.request(replacement), state.operatorId),
        'launch',
      ),
      handleExecutionHostRun(
        context(state.request({ commandId: randomUUID() }), state.operatorId),
        original.launchId,
        'cancel',
      ),
    ]
    const blocker = await database.pool.connect()
    await blocker.query('BEGIN')
    await blocker.query(
      'UPDATE member SET role = $1 WHERE organization_id = $2 AND user_id = $3',
      ['member', state.workspaceId, state.operatorId],
    )
    const pending = requests()
    try {
      let waiting = 0
      const deadline = Date.now() + 5000
      while (Date.now() < deadline) {
        const observed = await database.pool.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM pg_stat_activity
           WHERE datname = current_database() AND wait_event_type = 'Lock'
           AND query ~* 'member' AND query ~* 'for share'`,
        )
        waiting = Number(observed.rows[0]?.count ?? '0')
        if (waiting === 3) break
        await new Promise<void>((resolve) => setTimeout(resolve, 20))
      }
      await blocker.query('COMMIT')
      const responses = await Promise.all(pending)
      expect(waiting).toBe(3)
      for (const response of responses) {
        expect(response.status).toBe(403)
        expect(await response.json()).toMatchObject({
          error: 'Current workspace administration is required',
        })
      }
      for (const response of await Promise.all(requests()))
        expect(response.status).toBe(403)
      expect(
        await database.db
          .select()
          .from(schema.executionHost)
          .where(eq(schema.executionHost.id, extraEnrollment.hostId)),
      ).toHaveLength(0)
      const launches = await database.db
        .select()
        .from(schema.executionHostLaunch)
        .where(eq(schema.executionHostLaunch.workspaceId, state.workspaceId))
      expect(launches).toHaveLength(1)
      expect(launches[0]?.launchId).toBe(original.launchId)
      expect(launches[0]?.cancelCommandId).toBeNull()
    } finally {
      await blocker.query('ROLLBACK')
      blocker.release()
      await Promise.all(pending)
    }
  })

  it('rechecks actual session revocation inside the effect transaction after the fresh HTTP lookup', async () => {
    const state = await fixture()
    const blocker = await database.pool.connect()
    await blocker.query('BEGIN')
    await blocker.query(
      'SELECT id FROM auth_session WHERE id = $1 FOR UPDATE',
      [state.sessionId],
    )
    const pending = handleExecutionHostAction(
      context(state.request(), state.operatorId),
      'enroll',
    )
    try {
      let observedSessionLock = false
      // Observe the real receiver lock, rather than delaying a mocked auth response.
      const observationDeadline = Date.now() + 5000
      while (Date.now() < observationDeadline) {
        const waiting = await database.pool.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM pg_stat_activity
           WHERE datname = current_database() AND wait_event_type = 'Lock'
           AND query ~* 'auth_session' AND query ~* 'for share'`,
        )
        if (Number(waiting.rows[0]?.count ?? '0') > 0) {
          observedSessionLock = true
          break
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 20))
      }
      await blocker.query('DELETE FROM auth_session WHERE id = $1', [
        state.sessionId,
      ])
      await blocker.query('COMMIT')
      const response = await pending
      expect(observedSessionLock).toBe(true)
      expect(response.status).toBe(401)
      expect(await response.json()).toMatchObject({
        error: 'A current member session is required',
      })
      expect(
        await database.db
          .select()
          .from(schema.executionHost)
          .where(eq(schema.executionHost.id, state.enrollment.hostId)),
      ).toHaveLength(0)
    } finally {
      await blocker.query('ROLLBACK')
      blocker.release()
      await pending
    }
  })

  it('refuses a real session that expires while its unchanged row lock is pending', async () => {
    // A real non-persistent login disables Better Auth refresh without replacing auth.
    const state = await fixture(false)
    expect(state.cookie).toContain('dont_remember')
    const expiresAt = new Date(Date.now() + 3000)
    await database.db
      .update(schema.session)
      .set({ expiresAt })
      .where(eq(schema.session.id, state.sessionId))
    const blocker = await database.pool.connect()
    await blocker.query('BEGIN')
    await blocker.query(
      'SELECT id FROM auth_session WHERE id = $1 FOR UPDATE',
      [state.sessionId],
    )
    const pending = handleExecutionHostAction(
      context(state.request(), state.operatorId),
      'enroll',
    )
    try {
      let observedSessionLock = false
      const observationDeadline = Date.now() + 5000
      while (Date.now() < observationDeadline) {
        const waiting = await database.pool.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM pg_stat_activity
           WHERE datname = current_database() AND wait_event_type = 'Lock'
           AND query ~* 'auth_session' AND query ~* 'for share'`,
        )
        if (Number(waiting.rows[0]?.count ?? '0') > 0) {
          observedSessionLock = true
          break
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 20))
      }
      await new Promise<void>((resolve) =>
        setTimeout(
          resolve,
          Math.max(0, expiresAt.getTime() - Date.now() + 100),
        ),
      )
      // No row update occurs here. PostgreSQL must not reuse an earlier time predicate.
      await blocker.query('COMMIT')
      const response = await pending
      expect(observedSessionLock).toBe(true)
      expect(response.status).toBe(401)
      expect(await response.json()).toMatchObject({
        error: 'A current member session is required',
      })
      expect(
        await database.db
          .select()
          .from(schema.executionHost)
          .where(eq(schema.executionHost.id, state.enrollment.hostId)),
      ).toHaveLength(0)
    } finally {
      await blocker.query('ROLLBACK')
      blocker.release()
      await pending
    }
  })

  it('rolls back a host mutation when its actual session expires behind a later host lock', async () => {
    const state = await fixture(false)
    expect(
      (
        await handleExecutionHostAction(
          context(state.request(), state.operatorId),
          'enroll',
        )
      ).status,
    ).toBe(200)
    const expiresAt = new Date(Date.now() + 3000)
    await database.db
      .update(schema.session)
      .set({ expiresAt })
      .where(eq(schema.session.id, state.sessionId))
    const blocker = await database.pool.connect()
    await blocker.query('BEGIN')
    await blocker.query(
      'SELECT id FROM execution_host WHERE id = $1 FOR UPDATE',
      [state.enrollment.hostId],
    )
    const rotation = { ...state.enrollment, keyGeneration: 2 }
    const pending = handleExecutionHostAction(
      context(state.request(rotation), state.operatorId),
      'enroll',
    )
    try {
      let observedHostLock = false
      const observationDeadline = Date.now() + 5000
      while (Date.now() < observationDeadline) {
        const waiting = await database.pool.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM pg_stat_activity
           WHERE datname = current_database() AND wait_event_type = 'Lock'
           AND query ~* 'execution_host' AND query ~* 'for update'`,
        )
        if (Number(waiting.rows[0]?.count ?? '0') > 0) {
          observedHostLock = true
          break
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 20))
      }
      await new Promise<void>((resolve) =>
        setTimeout(
          resolve,
          Math.max(0, expiresAt.getTime() - Date.now() + 100),
        ),
      )
      await blocker.query('COMMIT')
      const response = await pending
      expect(observedHostLock).toBe(true)
      expect(response.status).toBe(401)
      expect(await response.json()).toMatchObject({
        error: 'A current member session is required',
      })
      const rows = await database.db
        .select()
        .from(schema.executionHost)
        .where(eq(schema.executionHost.id, state.enrollment.hostId))
      expect(rows).toHaveLength(1)
      expect(rows[0]?.keyGeneration).toBe(1)
      expect(rows[0]?.enrollment).toMatchObject({ keyGeneration: 1 })
    } finally {
      await blocker.query('ROLLBACK')
      blocker.release()
      await pending
    }
  })

  it.each([
    null,
    'null',
    'https://attacker.test',
    'http://garden.test',
    'https://garden.test:444',
    'garden-mobile://attacker',
    'garden-mobile:///',
  ])('refuses mutation Origin %s', async (origin) => {
    const state = await fixture()
    const response = await handleExecutionHostAction(
      context(state.request(undefined, { origin }), state.operatorId),
      'enroll',
    )
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      error: 'Request origin is not permitted',
    })
  })

  it('accepts only the exact native application Origin through the real permission check', async () => {
    const state = await fixture()
    const response = await handleExecutionHostAction(
      context(
        state.request(undefined, { origin: 'garden-mobile://' }),
        state.operatorId,
      ),
      'enroll',
    )
    expect(response.status).toBe(200)
  })

  it('requires an explicit workspace despite a real active organization and refuses a mismatched body', async () => {
    const state = await fixture()
    const missing = await handleExecutionHostAction(
      context(state.request(undefined, { workspace: null }), state.operatorId),
      'enroll',
    )
    expect(missing.status).toBe(400)
    expect(await missing.json()).toMatchObject({
      error: 'An explicit workspace ID is required',
    })
    const mismatched = await handleExecutionHostAction(
      context(
        state.request(undefined, { workspace: state.secondWorkspaceId }),
        state.operatorId,
      ),
      'enroll',
    )
    expect(mismatched.status).toBe(400)
    expect(await mismatched.json()).toMatchObject({
      error: 'Invalid enrollment scope',
    })
    const foreign = await handleExecutionHostAction(
      context(
        state.request(undefined, { workspace: randomUUID() }),
        state.operatorId,
      ),
      'enroll',
    )
    expect(foreign.status).toBe(401)
    expect(await foreign.json()).toMatchObject({ error: 'Unauthorized' })
  })

  it('keeps the pilot disabled without deployment configuration and refuses another operator', async () => {
    const state = await fixture()
    expect(
      (await handleExecutionHostAction(context(state.request()), 'enroll'))
        .status,
    ).toBe(503)
    expect(
      (
        await handleExecutionHostAction(
          context(state.request(), 'invalid-operator'),
          'enroll',
        )
      ).status,
    ).toBe(503)
    expect(
      (
        await handleExecutionHostAction(
          context(state.request(), randomUUID()),
          'enroll',
        )
      ).status,
    ).toBe(403)
  })

  it('does not accept a browser cookie as proof of host-key possession', async () => {
    const state = await fixture()
    expect(
      (
        await handleExecutionHostAction(
          context(state.request(), state.operatorId),
          'enroll',
        )
      ).status,
    ).toBe(200)
    const unsigned: HostRequestUnsigned = {
      contractVersion: hostContractVersion,
      hostId: state.enrollment.hostId,
      workspaceId: state.workspaceId,
      keyGeneration: 1,
      nonce: randomUUID(),
      signedAt: Date.now(),
      body: { operation: 'pull', afterSequence: 0 },
    }
    const forged = await handleExecutionHostAction(
      context(
        state.request({ ...unsigned, signature: 'A'.repeat(86) }),
        state.operatorId,
      ),
      'receive',
    )
    expect(forged.status).toBe(401)
    expect(await forged.json()).toMatchObject({
      error: 'Host signature or scope is invalid',
    })
    const signed = await signHostRequest(
      { ...unsigned, nonce: randomUUID(), signedAt: Date.now() },
      state.keys.privateKey,
    )
    const hostRequest = state.request(signed)
    hostRequest.headers.delete('cookie')
    hostRequest.headers.delete('origin')
    const received = await handleExecutionHostAction(
      context(hostRequest, state.operatorId),
      'receive',
    )
    expect(received.status).toBe(200)
    expect(await received.json()).toMatchObject({
      kind: 'commands',
      commands: [],
    })
  })

  it('rolls back a signed pull reservation and nonce when its grant expires behind the capacity lock', async () => {
    const state = await fixture()
    expect(
      (
        await handleExecutionHostAction(
          context(state.request(), state.operatorId),
          'enroll',
        )
      ).status,
    ).toBe(200)
    const launch = await launchInput(state.enrollment, 3000)
    const expiresAt = launch.grant.expiresAt
    const launched = await handleExecutionHostAction(
      context(state.request(launch), state.operatorId),
      'launch',
    )
    expect(launched.status).toBe(200)
    expect(launchReceiptSchema.parse(await launched.json())).toMatchObject({
      deliveryStatus: 'pending',
      runId: null,
    })
    await database.db
      .insert(schema.executionHostCapacity)
      .values({ operatorId: state.operatorId })
    const blocker = await database.pool.connect()
    await blocker.query('BEGIN')
    await blocker.query(
      'SELECT operator_id FROM execution_host_capacity WHERE operator_id = $1 FOR UPDATE',
      [state.operatorId],
    )
    const nonce = randomUUID()
    const signed = await signHostRequest(
      {
        contractVersion: hostContractVersion,
        hostId: state.enrollment.hostId,
        workspaceId: state.workspaceId,
        keyGeneration: 1,
        nonce,
        signedAt: Date.now(),
        body: { operation: 'pull', afterSequence: 0 },
      },
      state.keys.privateKey,
    )
    const request = new Request(`${ORIGIN}/api/execution-hosts/receive`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(signed),
    })
    const pending = handleExecutionHostAction(
      context(request, state.operatorId),
      'receive',
    )
    try {
      let observedCapacityLock = false
      const observationDeadline = Date.now() + 5000
      while (Date.now() < observationDeadline) {
        const waiting = await database.pool.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM pg_stat_activity
           WHERE datname = current_database() AND wait_event_type = 'Lock'
           AND query ~* 'execution_host_capacity' AND query ~* 'for update'`,
        )
        if (Number(waiting.rows[0]?.count ?? '0') > 0) {
          observedCapacityLock = true
          break
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 20))
      }
      await new Promise<void>((resolve) =>
        setTimeout(resolve, Math.max(0, expiresAt - Date.now() + 100)),
      )
      await blocker.query('COMMIT')
      const response = await pending
      expect(observedCapacityLock).toBe(true)
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({
        error: 'Host command authority expired before commit',
      })
      const capacity = await database.db
        .select()
        .from(schema.executionHostCapacity)
        .where(eq(schema.executionHostCapacity.operatorId, state.operatorId))
      expect(capacity[0]).toMatchObject({
        launchRecordId: null,
        reservedAt: null,
      })
      expect(
        await database.db
          .select()
          .from(schema.executionHostNonce)
          .where(
            and(
              eq(schema.executionHostNonce.hostId, state.enrollment.hostId),
              eq(schema.executionHostNonce.nonce, nonce),
            ),
          ),
      ).toHaveLength(0)
      const hosts = await database.db
        .select()
        .from(schema.executionHost)
        .where(eq(schema.executionHost.id, state.enrollment.hostId))
      expect(hosts[0]?.lastSeenAt).toBeNull()
    } finally {
      await blocker.query('ROLLBACK')
      blocker.release()
      await pending
    }
  })

  it('applies fresh session authority to snapshots and cancellation as well', async () => {
    const state = await fixture()
    await database.db
      .delete(schema.session)
      .where(eq(schema.session.id, state.sessionId))
    const launchId = randomUUID()
    for (const action of ['snapshot', 'cancel'] as const) {
      const response = await handleExecutionHostRun(
        context(state.request({ commandId: randomUUID() }), state.operatorId),
        launchId,
        action,
      )
      expect(response.status).toBe(401)
    }
  })

  it('applies the pilot guard to intervention reads and answers', async () => {
    const state = await fixture()
    const launchId = randomUUID()
    const answer = {
      interventionId: randomUUID(),
      answerId: randomUUID(),
      decision: 'stop',
    }
    for (const action of ['interventions', 'answer'] as const) {
      expect(
        (
          await handleExecutionHostRun(
            context(state.request(answer)),
            launchId,
            action,
          )
        ).status,
      ).toBe(503)
      expect(
        (
          await handleExecutionHostRun(
            context(state.request(answer), randomUUID()),
            launchId,
            action,
          )
        ).status,
      ).toBe(403)
      const missing = await handleExecutionHostRun(
        context(state.request(answer), state.operatorId),
        launchId,
        action,
      )
      expect(missing.status).toBe(404)
      expect(missing.headers.get('cache-control')).toBe('no-store')
    }
    expect(
      (
        await handleExecutionHostRun(
          context(
            state.request(answer, { origin: 'https://other.test' }),
            state.operatorId,
          ),
          launchId,
          'answer',
        )
      ).status,
    ).toBe(403)
    await database.db
      .delete(schema.session)
      .where(eq(schema.session.id, state.sessionId))
    for (const action of ['interventions', 'answer'] as const)
      expect(
        (
          await handleExecutionHostRun(
            context(state.request(answer), state.operatorId),
            launchId,
            action,
          )
        ).status,
      ).toBe(401)
  })

  it('accepts a signed pre-start decline and preserves another run reservation across retries', async () => {
    const state = await fixture()
    expect(
      (
        await handleExecutionHostAction(
          context(state.request(), state.operatorId),
          'enroll',
        )
      ).status,
    ).toBe(200)
    const send = async (body: HostRequestUnsigned['body']) => {
      const signed = await signHostRequest(
        {
          contractVersion: hostContractVersion,
          hostId: state.enrollment.hostId,
          workspaceId: state.workspaceId,
          keyGeneration: 1,
          nonce: randomUUID(),
          signedAt: Date.now(),
          body,
        },
        state.keys.privateKey,
      )
      const request = new Request(`${ORIGIN}/api/execution-hosts/receive`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(signed),
      })
      return handleExecutionHostAction(
        context(request, state.operatorId),
        'receive',
      )
    }
    const first = await launchInput(state.enrollment, 60_000)
    expect(
      (
        await handleExecutionHostAction(
          context(state.request(first), state.operatorId),
          'launch',
        )
      ).status,
    ).toBe(200)
    const pulled = await send({ operation: 'pull', afterSequence: 0 })
    expect(pulled.status).toBe(200)
    expect(hostOutcomeSchema.parse(await pulled.json())).toMatchObject({
      kind: 'commands',
      commands: [{ kind: 'launch' }],
    })
    const decline = {
      operation: 'decline' as const,
      launchId: first.launchId,
      requestDigest: first.requestDigest,
      declineId: randomUUID(),
      reason: 'allowance_unavailable' as const,
    }
    const declined = await send(decline)
    expect(declined.status).toBe(200)
    const receipt = hostOutcomeSchema.parse(await declined.json())
    expect(receipt).toMatchObject({
      kind: 'declined',
      declineId: decline.declineId,
      termination: 'not-started',
    })
    const capacityAfterDecline = await database.db
      .select()
      .from(schema.executionHostCapacity)
      .where(eq(schema.executionHostCapacity.operatorId, state.operatorId))
    expect(capacityAfterDecline[0]?.launchRecordId).toBeNull()
    const snapshot = await handleExecutionHostRun(
      context(state.directoryRequest(), state.operatorId),
      first.launchId,
      'snapshot',
    )
    expect(snapshot.status).toBe(200)
    expect(hostSnapshotSchema.parse(await snapshot.json())).toMatchObject({
      runId: null,
      termination: 'not-started',
      deliveryStatus: 'revoked',
      lastSequence: 0,
      events: [],
    })
    const second = await launchInput(state.enrollment, 60_000)
    expect(
      (
        await handleExecutionHostAction(
          context(state.request(second), state.operatorId),
          'launch',
        )
      ).status,
    ).toBe(200)
    expect((await send({ operation: 'pull', afterSequence: 0 })).status).toBe(
      200,
    )
    const repeated = await send(decline)
    expect(repeated.status).toBe(200)
    expect(hostOutcomeSchema.parse(await repeated.json())).toEqual(receipt)
    const secondRows = await database.db
      .select()
      .from(schema.executionHostLaunch)
      .where(eq(schema.executionHostLaunch.launchId, second.launchId))
    const retained = await database.db
      .select()
      .from(schema.executionHostCapacity)
      .where(eq(schema.executionHostCapacity.operatorId, state.operatorId))
    expect(retained[0]?.launchRecordId).toBe(secondRows[0]?.id)
    expect(
      (
        await send({
          operation: 'acknowledge',
          launchId: second.launchId,
          runId: second.launchId,
          requestDigest: second.requestDigest,
        })
      ).status,
    ).toBe(200)
    const afterStart = await send({
      ...decline,
      launchId: second.launchId,
      requestDigest: second.requestDigest,
      declineId: randomUUID(),
    })
    expect(afterStart.status).toBe(409)
    const afterRefusal = await database.db
      .select()
      .from(schema.executionHostCapacity)
      .where(eq(schema.executionHostCapacity.operatorId, state.operatorId))
    expect(afterRefusal[0]?.launchRecordId).toBe(secondRows[0]?.id)
  })
})

describe('execution-host HTTP discovery', () => {
  it('returns only explicit workspace hosts and omits key, actor, and private enrollment fields', async () => {
    const state = await fixture()
    expect(
      (
        await handleExecutionHostAction(
          context(state.request(), state.operatorId),
          'enroll',
        )
      ).status,
    ).toBe(200)
    const otherHost = {
      ...state.enrollment,
      hostId: randomUUID(),
      workspaceId: state.secondWorkspaceId,
    }
    expect(
      (
        await handleExecutionHostAction(
          context(
            state.request(otherHost, { workspace: state.secondWorkspaceId }),
            state.operatorId,
          ),
          'enroll',
        )
      ).status,
    ).toBe(200)
    const first = await handleExecutionHostDirectory(
      context(state.directoryRequest(), state.operatorId),
    )
    expect(first.status).toBe(200)
    expect(first.headers.get('cache-control')).toBe('no-store')
    const firstBody = hostDirectorySchema.parse(await first.json())
    expect(firstBody.workspaceId).toBe(state.workspaceId)
    expect(firstBody.hosts.map((host) => host.hostId)).toEqual([
      state.enrollment.hostId,
    ])
    expect(firstBody.hosts[0]).toEqual({
      hostId: state.enrollment.hostId,
      workspaceId: state.workspaceId,
      agent: 'claude-code',
      repositories: ['garden'],
      capabilityDigest: state.enrollment.capabilityDigest,
      keyGeneration: 1,
      status: 'enrolled',
      lastSeenAt: null,
    })
    const second = await handleExecutionHostDirectory(
      context(
        state.directoryRequest(state.secondWorkspaceId),
        state.operatorId,
      ),
    )
    expect(second.status).toBe(200)
    expect(
      hostDirectorySchema
        .parse(await second.json())
        .hosts.map((host) => host.hostId),
    ).toEqual([otherHost.hostId])
  })

  it('requires explicit workspace and fresh actual session authority for discovery', async () => {
    const state = await fixture()
    const missingWorkspace = await handleExecutionHostDirectory(
      context(state.directoryRequest(null), state.operatorId),
    )
    expect(missingWorkspace.status).toBe(400)
    const foreignWorkspace = await handleExecutionHostDirectory(
      context(state.directoryRequest(randomUUID()), state.operatorId),
    )
    expect(foreignWorkspace.status).toBe(401)
    const noCookie = state.directoryRequest()
    noCookie.headers.delete('cookie')
    expect(
      (await handleExecutionHostDirectory(context(noCookie, state.operatorId)))
        .status,
    ).toBe(401)
    await database.db
      .delete(schema.session)
      .where(eq(schema.session.id, state.sessionId))
    expect(
      (
        await handleExecutionHostDirectory(
          context(state.directoryRequest(), state.operatorId),
        )
      ).status,
    ).toBe(401)
  })

  it('refuses status reads while the pilot is unset, for another operator, and for an ordinary member', async () => {
    const state = await fixture()
    const disabled = await handleExecutionHostDirectory(
      context(state.directoryRequest()),
    )
    expect(disabled.status).toBe(503)
    // The status page shows its disabled state for exactly this answer.
    expect(await disabled.json()).toEqual({
      error: 'The engineering pilot is not configured',
    })
    expect(
      (
        await handleExecutionHostDirectory(
          context(state.directoryRequest(), randomUUID()),
        )
      ).status,
    ).toBe(403)
    await database.db
      .update(schema.member)
      .set({ role: 'member' })
      .where(
        and(
          eq(schema.member.organizationId, state.workspaceId),
          eq(schema.member.userId, state.operatorId),
        ),
      )
    expect(
      (
        await handleExecutionHostDirectory(
          context(state.directoryRequest(), state.operatorId),
        )
      ).status,
    ).toBe(403)
    expect(
      (
        await handleExecutionHostRun(
          context(state.directoryRequest(), state.operatorId),
          randomUUID(),
          'snapshot',
        )
      ).status,
    ).toBe(403)
  })

  it('returns a bounded directory cursor without skipping or repeating authorized rows', async () => {
    const state = await fixture()
    const ids = Array.from({ length: 101 }, () => randomUUID()).sort()
    await database.db.insert(schema.executionHost).values(
      ids.map((id) => ({
        id,
        workspaceId: state.workspaceId,
        operatorId: state.operatorId,
        keyGeneration: 1,
        enrollment: { ...state.enrollment, hostId: id },
      })),
    )
    const first = await handleExecutionHostDirectory(
      context(state.directoryRequest(), state.operatorId),
    )
    expect(first.status).toBe(200)
    const page = hostDirectorySchema.parse(await first.json())
    expect(page.hosts).toHaveLength(100)
    expect(page.nextHostId).toBe(ids[99])
    if (page.nextHostId === null)
      throw new Error('Expected the actual bounded host directory cursor')
    const second = await handleExecutionHostDirectory(
      context(
        state.directoryRequest(state.workspaceId, page.nextHostId),
        state.operatorId,
      ),
    )
    expect(second.status).toBe(200)
    const tail = hostDirectorySchema.parse(await second.json())
    expect([...page.hosts, ...tail.hosts].map((host) => host.hostId)).toEqual(
      ids,
    )
    expect(tail.nextHostId).toBeNull()
    const invalid = await handleExecutionHostDirectory(
      context(
        state.directoryRequest(state.workspaceId, 'invalid-cursor'),
        state.operatorId,
      ),
    )
    expect(invalid.status).toBe(400)
  })
})

describe('execution-host HTTP control body bounds', () => {
  it('cancels an actual over-limit stream even when Content-Length is absent or dishonest', async () => {
    for (const contentLength of [undefined, '1']) {
      let cancelled = false
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (let index = 0; index < 3; index++)
            controller.enqueue(new Uint8Array(8192))
        },
        cancel() {
          cancelled = true
        },
      })
      const headers = new Headers({ 'content-type': 'application/json' })
      if (contentLength !== undefined)
        headers.set('content-length', contentLength)
      const init: RequestInit & { duplex: 'half' } = {
        method: 'POST',
        headers,
        body,
        duplex: 'half',
      }
      const response = await handleExecutionHostAction(
        context(new Request(`${ORIGIN}/api/execution-hosts/receive`, init)),
        'receive',
      )
      expect(response.status).toBe(413)
      expect(cancelled).toBe(true)
    }
  })

  it('accepts exactly 16 KiB before the next gate and refuses one extra byte', async () => {
    for (const [size, status] of [
      [16_384, 503],
      [16_385, 413],
    ] as const) {
      const body = JSON.stringify({ x: 'x'.repeat(size - 8) })
      expect(new TextEncoder().encode(body).length).toBe(size)
      const request = new Request(`${ORIGIN}/api/execution-hosts/receive`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      })
      expect(
        (await handleExecutionHostAction(context(request), 'receive')).status,
      ).toBe(status)
    }
  })

  it.each(['-1', 'NaN', '16385'])(
    'refuses invalid or oversized Content-Length %s',
    async (length) => {
      const request = new Request(`${ORIGIN}/api/execution-hosts/receive`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': length,
        },
        body: '{}',
      })
      expect(
        (await handleExecutionHostAction(context(request), 'receive')).status,
      ).toBe(413)
    },
  )

  it('refuses malformed UTF-8, malformed JSON, missing bodies, and other content types', async () => {
    for (const body of [
      new Uint8Array([0xc3, 0x28]),
      new TextEncoder().encode('{invalid'),
    ]) {
      const request = new Request(`${ORIGIN}/api/execution-hosts/receive`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      })
      expect(
        (await handleExecutionHostAction(context(request), 'receive')).status,
      ).toBe(400)
    }
    for (const headers of [
      { 'content-type': 'application/json' },
      { 'content-type': 'text/plain' },
    ]) {
      const request = new Request(`${ORIGIN}/api/execution-hosts/receive`, {
        method: 'POST',
        headers,
      })
      expect(
        (await handleExecutionHostAction(context(request), 'receive')).status,
      ).toBe(400)
    }
  })
})
