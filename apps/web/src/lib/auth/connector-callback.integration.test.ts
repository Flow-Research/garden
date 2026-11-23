// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { PoolClient } from 'pg'
import {
  afterAll,
  beforeAll,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { Effect } from 'effect'
import { betterAuth, type BetterAuthOptions, type DBAdapter } from 'better-auth'
import { eq, and } from 'drizzle-orm'
import { startTestDb, type TestDb } from '@garden/db/testing'
import {
  account,
  connectorCallbackEvent,
  member,
  organization,
  session,
  user,
  verification,
} from '@garden/db/schema'
import { createBetterAuth } from './instance'
import { connectorCallbackRequest } from './connector-callback-request'

vi.mock('@/lib/server/capability-sync', () => ({
  syncCapabilities: vi.fn(() => Effect.succeed(undefined)),
}))

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Required fixture row is missing')
  return value
}

const origin = 'https://garden.example'
const env = {
  BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-long',
  BETTER_AUTH_URL: origin,
  GOOGLE_CLIENT_ID: 'local-google-client',
  GOOGLE_CLIENT_SECRET: 'local-google-secret',
  RESEND_API_KEY: undefined,
}

type Browser = {
  cookies: Map<string, string>
  userId: string
  workspaceId: string
  email: string
  sessionId: string
}
let database: TestDb
let tokenRequests: Array<URLSearchParams> = []
const tokenClaims = new Map<string, { email: string; sub: string }>()
const heldClients = new Set<PoolClient>()
const heldChildren = new Set<ChildProcessWithoutNullStreams>()
let tokenSubject = ''
let tokenFailure = false
let beforeTokenResponse: (() => Promise<void>) | undefined
let nestedAdapterAuthorityChange: (() => Promise<void>) | undefined
let nextAdapterFixture: ((adapter: DBAdapter) => DBAdapter) | undefined

async function call(
  path: string,
  browser: Pick<Browser, 'cookies'>,
  body?: Record<string, unknown>,
  omitBindingHook = false,
) {
  const request = new Request(`${origin}/api/auth${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(body ? { origin } : {}),
      cookie: [...browser.cookies]
        .map(([key, value]) => `${key}=${value}`)
        .join('; '),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const auth = createBetterAuth(database.db, { ...env, request })
  const accountHooks = auth.options.databaseHooks?.account
  const nestedTransactionAuth = nestedAdapterAuthorityChange
    ? betterAuth({
        ...auth.options,
        databaseHooks: {
          ...auth.options.databaseHooks,
          account: {
            ...accountHooks,
            create: {
              ...accountHooks?.create,
              before: async (record, context) => {
                const decoration = await accountHooks?.create?.before?.(
                  record,
                  context,
                )
                if (!context)
                  throw new Error('Expected callback account context')
                const data =
                  typeof decoration === 'object' && 'data' in decoration
                    ? { ...record, ...decoration.data }
                    : record
                await context.context.adapter.transaction(async (scoped) => {
                  await nestedAdapterAuthorityChange?.()
                  return scoped.create({
                    model: 'account',
                    data,
                    forceAllowId: true,
                  })
                })
                return false
              },
            },
          },
        },
      })
    : auth
  const adapterFixture = nextAdapterFixture
  nextAdapterFixture = undefined
  const selectedAuth = adapterFixture
    ? betterAuth({
        ...nestedTransactionAuth.options,
        database: (options: BetterAuthOptions) => {
          const factory = nestedTransactionAuth.options.database
          if (typeof factory !== 'function')
            throw new Error('Expected the supported adapter factory')
          const fixture = adapterFixture(factory(options))
          const scoped: DBAdapter = {
            ...fixture,
            transaction: (callback) =>
              fixture.transaction(() => callback(fixture)),
          }
          return scoped
        },
      })
    : nestedTransactionAuth
  const handler = omitBindingHook
    ? betterAuth({ ...auth.options, hooks: undefined }).handler
    : selectedAuth.handler
  const response = await handler(connectorCallbackRequest(request, env))
  for (const cookie of response.headers.getSetCookie()) {
    const pair = required(cookie.split(';')[0])
    const index = pair.indexOf('=')
    browser.cookies.set(pair.slice(0, index), pair.slice(index + 1))
  }
  return response
}

async function browser(rememberMe?: boolean): Promise<Browser> {
  const email = `${randomUUID()}@example.com`
  const cookies = new Map<string, string>()
  const response = await call(
    '/sign-up/email',
    { cookies },
    {
      email,
      password: 'test-password-12345',
      name: 'Test Person',
      ...(rememberMe === undefined ? {} : { rememberMe }),
    },
  )
  expect(response.status).toBe(200)
  const actor = required(
    (await database.db.select().from(user).where(eq(user.email, email)))[0],
  )
  const workspace = required(
    (
      await database.db
        .insert(organization)
        .values({ name: 'Test Workspace', slug: randomUUID() })
        .returning()
    )[0],
  )
  await database.db
    .insert(member)
    .values({ organizationId: workspace.id, userId: actor.id, role: 'owner' })
  const current = required(
    (
      await database.db
        .update(session)
        .set({ activeOrganizationId: workspace.id })
        .where(eq(session.userId, actor.id))
        .returning()
    )[0],
  )
  return {
    cookies,
    userId: actor.id,
    workspaceId: workspace.id,
    sessionId: current.id,
    email,
  }
}

async function start(
  browser: Browser,
  additionalData?: Record<string, unknown>,
  omitBindingHook = false,
  flowId = randomUUID(),
) {
  const response = await call(
    '/link-social',
    browser,
    {
      provider: 'gmail',
      callbackURL: `${origin}/settings/connections?connector_flow=${flowId}`,
      ...(additionalData ? { additionalData } : {}),
    },
    omitBindingHook,
  )
  expect(response.status).toBe(200)
  const body = (await response.json()) as { url: string }
  const authorization = new URL(body.url)
  expect(authorization.searchParams.get('redirect_uri')).toBe(
    `${origin}/api/auth/oauth2/callback/gmail`,
  )
  const state = authorization.searchParams.get('state')
  expect(state).toBeTruthy()
  return state!
}

async function finish(browser: Browser, state: string, provider = 'gmail') {
  tokenSubject ||= randomUUID()
  const code = randomUUID()
  tokenClaims.set(code, { email: browser.email, sub: tokenSubject })
  return call(
    `/oauth2/callback/${provider}?code=${code}&state=${encodeURIComponent(state)}`,
    browser,
  )
}

async function outcomes(browser: Browser) {
  return {
    accounts: await database.db
      .select()
      .from(account)
      .where(
        and(
          eq(account.userId, browser.userId),
          eq(account.providerId, 'gmail'),
        ),
      ),
    events: await database.db
      .select()
      .from(connectorCallbackEvent)
      .where(eq(connectorCallbackEvent.userId, browser.userId)),
  }
}

async function lockedAccount(actor: Browser) {
  tokenSubject = randomUUID()
  const existing = required(
    (
      await database.db
        .insert(account)
        .values({
          userId: actor.userId,
          workspaceId: actor.workspaceId,
          providerId: 'gmail',
          accountId: tokenSubject,
          accessToken: 'unchanged',
        })
        .returning()
    )[0],
  )
  const client = await database.pool.connect()
  heldClients.add(client)
  await client.query('begin')
  await client.query('select id from auth_account where id=$1 for update', [
    existing.id,
  ])
  return { existing, client }
}

async function waitForAccountLock() {
  for (let attempt = 0; attempt < 200; attempt++) {
    const result = await database.pool.query<{ pid: number }>(
      "select pid from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%auth_account%' and pid <> pg_backend_pid()",
    )
    if (result.rows[0]) return result.rows[0].pid
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Callback did not reach the actual account lock')
}

describe('real connector OAuth handler and account authority', () => {
  beforeAll(async () => {
    database = await startTestDb()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input)
        if (url !== 'https://oauth2.googleapis.com/token')
          throw new Error(`Unexpected external request: ${url}`)
        const body =
          input instanceof Request
            ? await input.text()
            : String(init?.body ?? '')
        tokenRequests.push(new URLSearchParams(body))
        await beforeTokenResponse?.()
        if (tokenFailure)
          return Response.json({ error: 'invalid_grant' }, { status: 400 })
        const claims = tokenClaims.get(
          new URLSearchParams(body).get('code') ?? '',
        )
        if (!claims) throw new Error('Unexpected local token code')
        const payload = Buffer.from(
          JSON.stringify({
            sub: claims.sub,
            email: claims.email,
            email_verified: true,
            name: 'Test Person',
          }),
        ).toString('base64url')
        return Response.json({
          access_token: 'local-access-token',
          token_type: 'Bearer',
          expires_in: 3600,
          id_token: `eyJhbGciOiJub25lIn0.${payload}.fixture`,
          scope: 'gmail.readonly',
        })
      }),
    )
  })
  afterEach(async () => {
    for (const child of heldChildren) {
      const closed = new Promise<void>((resolve) =>
        child.once('close', () => resolve()),
      )
      child.kill('SIGKILL')
      await closed
    }
    heldChildren.clear()
    for (const client of heldClients) {
      await client.query('rollback')
      client.release()
    }
    heldClients.clear()
    await database.pool.query(
      'alter table connector_callback_event drop constraint if exists security_test_receipt_fault',
    )
    tokenRequests = []
    tokenClaims.clear()
    tokenSubject = ''
    tokenFailure = false
    beforeTokenResponse = undefined
    nestedAdapterAuthorityChange = undefined
    nextAdapterFixture = undefined
  })
  afterAll(async () => {
    vi.unstubAllGlobals()
    await database?.cleanup()
  })

  it('retains password sign-in and refuses credential removal by the new account ID contract', async () => {
    const actor = await browser()
    const [credential] = await database.db
      .select()
      .from(account)
      .where(
        and(
          eq(account.userId, actor.userId),
          eq(account.providerId, 'credential'),
        ),
      )
    const denied = await call('/unlink-account', actor, {
      accountId: required(credential).id,
    })
    expect(denied.status).toBe(400)
    expect(await denied.json()).toMatchObject({
      code: 'CREDENTIAL_UNLINK_NOT_SUPPORTED',
    })
    const signedOutCookies = new Map(actor.cookies)
    expect((await call('/sign-out', actor, {})).status).toBe(200)
    const revoked = await call('/get-session?disableCookieCache=true', {
      cookies: signedOutCookies,
    })
    expect(await revoked.json()).toBeNull()
    const signedIn = await call('/sign-in/email', actor, {
      email: actor.email,
      password: 'test-password-12345',
    })
    expect(signedIn.status).toBe(200)
    expect(await signedIn.json()).toMatchObject({ user: { id: actor.userId } })
  })

  it('unlinks only the caller-owned Google row while preserving password sign-in', async () => {
    const actor = await browser()
    const foreign = await browser()
    const ownGoogle = required(
      (
        await database.db
          .insert(account)
          .values({
            userId: actor.userId,
            accountId: randomUUID(),
            providerId: 'google',
          })
          .returning()
      )[0],
    )
    const foreignGoogle = required(
      (
        await database.db
          .insert(account)
          .values({
            userId: foreign.userId,
            accountId: randomUUID(),
            providerId: 'google',
          })
          .returning()
      )[0],
    )
    const denied = await call('/unlink-account', actor, {
      accountId: foreignGoogle.id,
    })
    expect(denied.status).toBe(400)
    expect(
      await database.db
        .select()
        .from(account)
        .where(eq(account.id, foreignGoogle.id)),
    ).toHaveLength(1)
    expect(
      (await call('/unlink-account', actor, { accountId: ownGoogle.id }))
        .status,
    ).toBe(200)
    const retained = await database.db
      .select()
      .from(account)
      .where(eq(account.userId, actor.userId))
    expect(retained.map((row) => row.providerId)).toEqual(['credential'])
  })

  it('retains the registered redirect and writes one owned account and receipt', async () => {
    const actor = await browser()
    const state = await start(actor)
    const response = await finish(actor, state)
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toContain('/settings/connections')
    const result = await outcomes(actor)
    expect(result.accounts).toHaveLength(1)
    expect(required(result.accounts[0])).toMatchObject({
      workspaceId: actor.workspaceId,
      status: 'connected',
      connectorType: 'gmail',
    })
    expect(result.events).toHaveLength(1)
    expect(required(result.events[0]).status).toBe('success')
    expect(required(tokenRequests[0]).get('redirect_uri')).toBe(
      `${origin}/api/auth/oauth2/callback/gmail`,
    )
  })
  it('ignores forged additionalData authority and reconnects the same owned identity', async () => {
    const actor = await browser()
    const foreign = await browser()
    tokenSubject = randomUUID()
    const first = await start(actor, {
      gardenConnector: {
        userId: foreign.userId,
        workspaceId: foreign.workspaceId,
        providerId: 'slack',
      },
      serverContext: {
        gardenConnector: {
          userId: foreign.userId,
          workspaceId: foreign.workspaceId,
          sessionId: foreign.sessionId,
          providerId: 'slack',
        },
      },
    })
    await finish(actor, first)
    const original = required((await outcomes(actor)).accounts[0])
    expect(original.workspaceId).toBe(actor.workspaceId)
    const second = await start(actor)
    expect((await finish(actor, second)).status).toBe(302)
    const result = await outcomes(actor)
    expect(result.accounts).toHaveLength(1)
    expect(required(result.accounts[0]).id).toBe(original.id)
    expect(result.events).toHaveLength(2)
    expect((await outcomes(foreign)).events).toHaveLength(0)
  })

  it('refuses old unbound state even when additionalData spoofs a full binding', async () => {
    const actor = await browser()
    const state = await start(
      actor,
      {
        serverContext: {
          gardenConnector: {
            userId: actor.userId,
            workspaceId: actor.workspaceId,
            sessionId: actor.sessionId,
            providerId: 'gmail',
          },
        },
      },
      true,
    )
    await finish(actor, state)
    expect(await outcomes(actor)).toEqual({ accounts: [], events: [] })
  })

  it('consumes callback state once and does not duplicate an account or receipt on replay', async () => {
    const actor = await browser()
    const state = await start(actor)
    await finish(actor, state)
    await finish(actor, state)
    const result = await outcomes(actor)
    expect(result.accounts).toHaveLength(1)
    expect(result.events).toHaveLength(1)
    expect(tokenRequests).toHaveLength(1)
  })

  it('admits only one concurrent callback for the same state and cookie', async () => {
    const actor = await browser()
    const initial = await start(actor)
    await finish(actor, initial)
    const original = required((await outcomes(actor)).accounts[0])
    const reused = await start(actor)
    const identifier = `auth-state:${reused}`
    const locker = await database.pool.connect()
    heldClients.add(locker)
    await locker.query('begin')
    expect(
      (
        await locker.query(
          'select id from auth_verification where identifier=$1 for update',
          [identifier],
        )
      ).rowCount,
    ).toBe(1)
    let snapshots = 0
    const instrument = (adapter: DBAdapter): DBAdapter => ({
      ...adapter,
      findMany: async <T>(input: Parameters<DBAdapter['findMany']>[0]) => {
        const rows = await adapter.findMany<T>(input)
        if (
          input.model === 'verification' &&
          input.where?.some((condition) => condition.value === identifier) &&
          input.sortBy?.field === 'createdAt' &&
          rows.length > 0
        )
          snapshots++
        return rows
      },
    })
    nextAdapterFixture = instrument
    const first = finish({ ...actor, cookies: new Map(actor.cookies) }, reused)
    nextAdapterFixture = instrument
    const second = finish({ ...actor, cookies: new Map(actor.cookies) }, reused)
    let waiters = 0
    for (let attempt = 0; attempt < 200; attempt++) {
      const waiting = await database.pool.query(
        "select pid from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%delete%auth_verification%' and pid <> pg_backend_pid()",
      )
      waiters = waiting.rowCount ?? 0
      if (snapshots >= 2 && waiters >= 1) break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    await locker.query('rollback')
    locker.release()
    heldClients.delete(locker)
    const responses = await Promise.all([first, second])
    expect(snapshots).toBeGreaterThanOrEqual(2)
    expect(waiters).toBeGreaterThanOrEqual(1)
    expect(responses.map((response) => response.status)).toEqual([302, 302])
    const locations = responses.map((response) =>
      response.headers.get('location'),
    )
    expect(
      locations.filter((location) =>
        location?.includes('/settings/connections'),
      ),
    ).toHaveLength(1)
    expect(
      locations.filter((location) => location?.includes('state_mismatch')),
    ).toHaveLength(1)
    const result = await outcomes(actor)
    expect(result.accounts.map((row) => row.id)).toEqual([original.id])
    expect(result.events).toHaveLength(2)
    expect(tokenRequests).toHaveLength(2)
  })

  it('rejects an earlier snapshot after another callback consumes the state', async () => {
    const actor = await browser()
    await finish(actor, await start(actor))
    const original = required((await outcomes(actor)).accounts[0])
    const reused = await start(actor)
    const identifier = `auth-state:${reused}`
    let observed!: () => void
    let resume!: () => void
    const snapshot = new Promise<void>((resolve) => {
      observed = resolve
    })
    const resumed = new Promise<void>((resolve) => {
      resume = resolve
    })
    let paused = false
    let snapshotRows = 0
    nextAdapterFixture = (adapter) => ({
      ...adapter,
      findMany: async <T>(input: Parameters<DBAdapter['findMany']>[0]) => {
        const rows = await adapter.findMany<T>(input)
        if (
          !paused &&
          input.model === 'verification' &&
          input.sortBy?.field === 'createdAt' &&
          input.where?.some((condition) => condition.value === identifier)
        ) {
          paused = true
          snapshotRows = rows.length
          observed()
          await resumed
        }
        return rows
      },
    })
    const later = finish({ ...actor, cookies: new Map(actor.cookies) }, reused)
    await snapshot
    expect(snapshotRows).toBe(1)
    const winner = await finish(
      { ...actor, cookies: new Map(actor.cookies) },
      reused,
    )
    resume()
    const loser = await later
    expect(winner.headers.get('location')).toContain('/settings/connections')
    expect(loser.headers.get('location')).toContain('state_mismatch')
    const result = await outcomes(actor)
    expect(result.accounts.map((row) => row.id)).toEqual([original.id])
    expect(result.events).toHaveLength(2)
    expect(tokenRequests).toHaveLength(2)
  })

  it('does not consume valid state for a browser with the wrong signed state cookie', async () => {
    const actor = await browser()
    const state = await start(actor)
    const foreign = await browser()
    await start(foreign)
    const wrongCookies = new Map(actor.cookies)
    for (const [key, value] of foreign.cookies)
      if (key.endsWith('.state')) wrongCookies.set(key, value)
    const denied = await finish({ ...actor, cookies: wrongCookies }, state)
    expect(denied.headers.get('location')).toContain('state_mismatch')
    expect(await outcomes(actor)).toEqual({ accounts: [], events: [] })
    expect(tokenRequests).toHaveLength(0)
    expect((await finish(actor, state)).headers.get('location')).toContain(
      '/settings/connections',
    )
    expect((await outcomes(actor)).events).toHaveLength(1)
    expect(tokenRequests).toHaveLength(1)
  })

  it('refuses expired database state without exchanging a token or writing a receipt', async () => {
    const actor = await browser()
    const state = await start(actor)
    await database.db
      .update(verification)
      .set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(verification.identifier, `auth-state:${state}`))
    const denied = await finish(actor, state)
    expect(denied.headers.get('location')).toContain('state_mismatch')
    expect(await outcomes(actor)).toEqual({ accounts: [], events: [] })
    expect(tokenRequests).toHaveLength(0)
  })

  it('refuses a failed atomic consumption before token exchange or account mutation', async () => {
    const actor = await browser()
    const state = await start(actor)
    let consumed = false
    nextAdapterFixture = (adapter) => ({
      ...adapter,
      consumeOne: async (input) => {
        if (input.model === 'verification') {
          consumed = true
          throw new Error('Injected atomic state consumption failure')
        }
        return adapter.consumeOne(input)
      },
    })
    const denied = await finish(actor, state)
    expect(consumed).toBe(true)
    expect(denied.status).toBe(302)
    expect(denied.headers.get('location')).toContain('/api/auth/error?')
    expect(await outcomes(actor)).toEqual({ accounts: [], events: [] })
    expect(tokenRequests).toHaveLength(0)
  })

  it.each(['id', 'value'] as const)(
    'refuses a consumed state with a changed %s after the initial snapshot',
    async (field) => {
      const actor = await browser()
      const state = await start(actor)
      const identifier = `auth-state:${state}`
      let changed = false
      nextAdapterFixture = (adapter) => ({
        ...adapter,
        findMany: async <T>(input: Parameters<DBAdapter['findMany']>[0]) => {
          const rows = await adapter.findMany<T>(input)
          if (
            !changed &&
            input.model === 'verification' &&
            input.sortBy?.field === 'createdAt' &&
            input.where?.some((condition) => condition.value === identifier)
          ) {
            changed = true
            const original = required(
              (
                await database.db
                  .select()
                  .from(verification)
                  .where(eq(verification.identifier, identifier))
              )[0],
            )
            await database.db
              .update(verification)
              .set(
                field === 'id'
                  ? { id: randomUUID() }
                  : { value: `${original.value} ` },
              )
              .where(eq(verification.id, original.id))
          }
          return rows
        },
      })
      const denied = await finish(actor, state)
      expect(changed).toBe(true)
      expect(denied.headers.get('location')).toContain('state_mismatch')
      expect(await outcomes(actor)).toEqual({ accounts: [], events: [] })
      expect(tokenRequests).toHaveLength(0)
    },
  )

  it('consumes one PostgreSQL verification row across two fresh Node processes', async () => {
    const identifier = `auth-state:${randomUUID()}`
    const row = required(
      (
        await database.db
          .insert(verification)
          .values({
            identifier,
            value: 'cross-process-consume-fixture',
            expiresAt: new Date(Date.now() + 60_000),
          })
          .returning()
      )[0],
    )
    // Separate SDK module instances cannot share its in-memory consume mutex.
    // This proves the atomic storage operation, not a whole callback journey.
    const script = `
      import { Pool } from 'pg';
      import { drizzle } from 'drizzle-orm/node-postgres';
      import { betterAuth } from 'better-auth';
      import { drizzleAdapter } from 'better-auth/adapters/drizzle';
      const schema = await import(process.argv[3]);
      const pool = new Pool({connectionString: process.argv[1]});
      const auth = betterAuth({
        secret: 'local-consume-test-secret-at-least-32-characters',
        database: drizzleAdapter(drizzle(pool, {schema}), {provider: 'pg', schema}),
        verification: {disableCleanup: true},
        user: {fields: {image: 'avatarUrl'}},
      });
      const context = await auth.$context;
      const deadline = setTimeout(() => process.exit(2), 30_000);
      process.stdout.write('ready\\n');
      await new Promise(resolve => process.stdin.once('data', resolve));
      const row = await context.internalAdapter.consumeVerificationValue(process.argv[2]);
      process.stdout.write(JSON.stringify({pid: process.pid, id: row?.id ?? null})+'\\n');
      await pool.end();
      clearTimeout(deadline);
      process.stdin.destroy();
    `
    const launch = () => {
      const child = spawn(
        process.execPath,
        [
          '--import',
          'tsx',
          '--input-type=module',
          '-e',
          script,
          database.databaseUrl,
          identifier,
          new URL(
            '../../../../../packages/db/src/schema/index.ts',
            import.meta.url,
          ).href,
        ],
        { stdio: 'pipe' },
      )
      heldChildren.add(child)
      let output = ''
      let errors = ''
      let announced = false
      let announce!: () => void
      let refuseReady!: (error: Error) => void
      let refuseResult!: (error: Error) => void
      const ready = new Promise<void>((resolve, reject) => {
        announce = resolve
        refuseReady = reject
      })
      // A missing readiness message previously left this fixture waiting for
      // the entire suite timeout. Bound and reap only this owned child.
      const deadline = setTimeout(() => {
        const error = new Error(
          'Atomic consume child exceeded its 30-second bound',
        )
        refuseReady(error)
        refuseResult(error)
        child.kill('SIGKILL')
      }, 30_000)
      const completed = new Promise<{ pid: number; id: string | null }>(
        (resolve, reject) => {
          refuseResult = reject
          child.once('error', (error) => {
            clearTimeout(deadline)
            refuseReady(error)
            reject(error)
          })
          child.once('close', (code) => {
            clearTimeout(deadline)
            heldChildren.delete(child)
            if (!announced)
              refuseReady(
                new Error(`Consume child exited before readiness: ${errors}`),
              )
            if (code !== 0) {
              reject(new Error(`Consume child exited ${code}: ${errors}`))
              return
            }
            const line = output
              .split('\n')
              .find((entry) => entry.startsWith('{'))
            if (!line) {
              reject(new Error('Consume child returned no result'))
              return
            }
            Promise.resolve()
              .then(
                () => JSON.parse(line) as { pid: number; id: string | null },
              )
              .then(resolve, reject)
          })
        },
      )
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString()
        if (output.length > 65_536) {
          const error = new Error('Consume child exceeded its output bound')
          refuseReady(error)
          refuseResult(error)
          child.kill('SIGKILL')
          return
        }
        if (!announced && output.includes('ready\n')) {
          announced = true
          announce()
        }
      })
      child.stderr.on('data', (chunk: Buffer) => {
        errors += chunk.toString()
        if (errors.length > 65_536) {
          const error = new Error(
            'Consume child exceeded its error-output bound',
          )
          refuseReady(error)
          refuseResult(error)
          child.kill('SIGKILL')
        }
      })
      return { child, ready, completed }
    }
    const first = launch()
    const second = launch()
    const ready = Promise.all([first.ready, second.ready]).then(() => {
      first.child.stdin.end('consume')
      second.child.stdin.end('consume')
    })
    const [, results] = await Promise.all([
      ready,
      Promise.all([first.completed, second.completed]),
    ])
    expect(new Set(results.map((result) => result.pid)).size).toBe(2)
    expect(results.filter((result) => result.id === row.id)).toHaveLength(1)
    expect(results.filter((result) => result.id === null)).toHaveLength(1)
    expect(
      await database.db
        .select()
        .from(verification)
        .where(eq(verification.id, row.id)),
    ).toHaveLength(0)
  })

  it('refuses a known-provider substitution after state validation', async () => {
    const actor = await browser()
    const state = await start(actor)
    await finish(actor, state, 'google-drive')
    const rows = await database.db
      .select()
      .from(account)
      .where(eq(account.userId, actor.userId))
    expect(rows.map((row) => row.providerId)).toEqual(['credential'])
    expect((await outcomes(actor)).events).toHaveLength(0)
  })

  it('refuses a forged state before token exchange', async () => {
    const actor = await browser()
    await finish(actor, randomUUID())
    expect(await outcomes(actor)).toEqual({ accounts: [], events: [] })
    expect(tokenRequests).toHaveLength(0)
  })

  it('does not create accounts or receipts when token exchange fails', async () => {
    const actor = await browser()
    const state = await start(actor)
    tokenFailure = true
    await finish(actor, state)
    expect(await outcomes(actor)).toEqual({ accounts: [], events: [] })
  })

  it('refuses a foreign browser using another actor’s callback state', async () => {
    const actor = await browser()
    const foreign = await browser()
    const state = await start(actor)
    // The OAuth state cookie belongs to the original browser, but the current
    // signed session belongs to the foreign actor. This is not a cookie-cache check.
    const mixed: Browser = { ...actor, cookies: new Map(actor.cookies) }
    for (const [key, value] of foreign.cookies)
      if (key.includes('session')) mixed.cookies.set(key, value)
    await finish(mixed, state)
    expect(await outcomes(actor)).toEqual({ accounts: [], events: [] })
    expect(await outcomes(foreign)).toEqual({ accounts: [], events: [] })
  })

  it.each(['logout', 'workspace', 'membership', 'expiry'] as const)(
    'refuses %s changes during token exchange',
    async (change) => {
      const actor = await browser()
      const state = await start(actor)
      beforeTokenResponse = async () => {
        if (change === 'logout') await call('/sign-out', actor, {})
        if (change === 'workspace')
          await database.db
            .update(session)
            .set({ activeOrganizationId: null })
            .where(eq(session.id, actor.sessionId))
        if (change === 'membership')
          await database.db
            .delete(member)
            .where(
              and(
                eq(member.userId, actor.userId),
                eq(member.organizationId, actor.workspaceId),
              ),
            )
        if (change === 'expiry')
          await database.db
            .update(session)
            .set({ expiresAt: new Date(Date.now() - 1) })
            .where(eq(session.id, actor.sessionId))
      }
      await finish(actor, state)
      expect(await outcomes(actor)).toEqual({ accounts: [], events: [] })
    },
  )

  it('does not retarget an identity linked to a different owner', async () => {
    const actor = await browser()
    const foreign = await browser()
    tokenSubject = randomUUID()
    const existing = required(
      (
        await database.db
          .insert(account)
          .values({
            userId: foreign.userId,
            workspaceId: foreign.workspaceId,
            providerId: 'gmail',
            accountId: tokenSubject,
            accessToken: 'unchanged',
          })
          .returning()
      )[0],
    )
    const state = await start(actor)
    await finish(actor, state)
    expect(await outcomes(actor)).toEqual({ accounts: [], events: [] })
    const retained = required(
      (
        await database.db
          .select()
          .from(account)
          .where(eq(account.id, existing.id))
      )[0],
    )
    expect(retained).toMatchObject({
      userId: foreign.userId,
      workspaceId: foreign.workspaceId,
      accessToken: 'unchanged',
    })
    expect((await outcomes(foreign)).events).toHaveLength(0)
  })

  it('refuses reconnecting an owned account into a different workspace', async () => {
    const actor = await browser()
    const other = required(
      (
        await database.db
          .insert(organization)
          .values({ name: 'Other Workspace', slug: randomUUID() })
          .returning()
      )[0],
    )
    tokenSubject = randomUUID()
    const existing = required(
      (
        await database.db
          .insert(account)
          .values({
            userId: actor.userId,
            workspaceId: other.id,
            providerId: 'gmail',
            accountId: tokenSubject,
            accessToken: 'unchanged',
          })
          .returning()
      )[0],
    )
    const state = await start(actor)
    await finish(actor, state)
    const retained = required(
      (
        await database.db
          .select()
          .from(account)
          .where(eq(account.id, existing.id))
      )[0],
    )
    expect(retained).toMatchObject({
      workspaceId: other.id,
      accessToken: 'unchanged',
    })
    expect((await outcomes(actor)).events).toHaveLength(0)
  })

  it('rejects connector sign-in instead of bypassing the workspace link flow', async () => {
    const actor = await browser()
    const response = await call('/sign-in/social', actor, {
      provider: 'gmail',
      callbackURL: origin,
    })
    expect(response.status).toBe(403)
    expect(await outcomes(actor)).toEqual({ accounts: [], events: [] })
  })

  it('never rewrites unknown providers, POSTs or encoded path suffixes', () => {
    for (const url of [
      `${origin}/api/auth/oauth2/callback/unknown`,
      `${origin}/api/auth/oauth2/callback/gmail%2Fextra`,
      `${origin}/api/auth/oauth2/callback/gmail/extra`,
    ]) {
      const request = new Request(url)
      expect(connectorCallbackRequest(request, env)).toBe(request)
    }
    const post = new Request(`${origin}/api/auth/oauth2/callback/gmail`, {
      method: 'POST',
    })
    expect(connectorCallbackRequest(post, env)).toBe(post)
  })

  it('rechecks session expiry after waiting for the real account row lock', async () => {
    const actor = await browser()
    const state = await start(actor)
    const { existing, client } = await lockedAccount(actor)
    const pending = finish(actor, state)
    await waitForAccountLock()
    await database.db
      .update(session)
      .set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(session.id, actor.sessionId))
    await client.query('rollback')
    client.release()
    heldClients.delete(client)
    await pending
    const result = await outcomes(actor)
    expect(result.accounts).toHaveLength(1)
    expect(required(result.accounts[0])).toMatchObject({
      id: existing.id,
      accessToken: 'unchanged',
    })
    expect(result.events).toHaveLength(0)
  })

  it('refuses an unchanged session that expires while the later membership lock is held', async () => {
    const actor = await browser(false)
    expect(
      [...actor.cookies.keys()].some((key) => key.includes('dont_remember')),
    ).toBe(true)
    const state = await start(actor)
    const client = await database.pool.connect()
    heldClients.add(client)
    await client.query('begin')
    await client.query(
      'select id from member where user_id=$1 and organization_id=$2 for update',
      [actor.userId, actor.workspaceId],
    )
    let deadline = 0
    beforeTokenResponse = async () => {
      deadline = Date.now() + 5_000
      await database.db
        .update(session)
        .set({ expiresAt: new Date(deadline) })
        .where(eq(session.id, actor.sessionId))
    }
    const pending = finish(actor, state)
    let waitingPid: number | undefined
    for (let attempt = 0; attempt < 200; attempt++) {
      const waiting = await database.pool.query<{ pid: number }>(
        "select pid from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%\"member\"%' and pid <> pg_backend_pid()",
      )
      if (waiting.rows[0]) {
        waitingPid = waiting.rows[0].pid
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(
      waitingPid,
      'Callback must reach the later membership lock before expiry',
    ).toBeDefined()
    const locks = await database.pool.query<{ relation: string; mode: string }>(
      'select relation::regclass::text as relation, mode from pg_locks where pid=$1 and granted and relation is not null',
      [waitingPid],
    )
    expect(locks.rows).toContainEqual({
      relation: 'auth_session',
      mode: 'RowShareLock',
    })
    const before = required(
      (
        await database.db
          .select()
          .from(session)
          .where(eq(session.id, actor.sessionId))
      )[0],
    )
    expect(before.expiresAt.getTime()).toBe(deadline)
    expect(Date.now()).toBeLessThan(deadline)
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, deadline - Date.now() + 25)),
    )
    await client.query('rollback')
    client.release()
    heldClients.delete(client)
    const response = await pending
    expect(response.status).toBe(403)
    expect(await outcomes(actor)).toEqual({ accounts: [], events: [] })
    const after = required(
      (
        await database.db
          .select()
          .from(session)
          .where(eq(session.id, actor.sessionId))
      )[0],
    )
    expect(after.expiresAt.getTime()).toBe(deadline)
  })

  it('keeps the authority guard inside the supported adapter transaction callback', async () => {
    const actor = await browser()
    const state = await start(actor)
    let entered = false
    nestedAdapterAuthorityChange = async () => {
      entered = true
      await database.db
        .update(session)
        .set({ activeOrganizationId: null })
        .where(eq(session.id, actor.sessionId))
    }
    const response = await finish(actor, state)
    expect(entered).toBe(true)
    expect(response.status).toBe(403)
    expect(await outcomes(actor)).toEqual({ accounts: [], events: [] })
  })

  it('refuses a failed database lock query without writing an account or receipt', async () => {
    const actor = await browser()
    const state = await start(actor)
    const { existing, client } = await lockedAccount(actor)
    const pending = finish(actor, state)
    const pid = await waitForAccountLock()
    await database.pool.query('select pg_cancel_backend($1)', [pid])
    const response = await pending
    await client.query('rollback')
    client.release()
    heldClients.delete(client)
    expect(response.status).toBe(500)
    const result = await outcomes(actor)
    expect(required(result.accounts[0])).toMatchObject({
      id: existing.id,
      accessToken: 'unchanged',
    })
    expect(result.events).toHaveLength(0)
  })

  it.each(['same owner', 'different owners'] as const)(
    'serializes concurrent absent identity creation for %s',
    async (owners) => {
      const actor = await browser()
      const second =
        owners === 'same owner'
          ? { ...actor, cookies: new Map(actor.cookies) }
          : await browser()
      const firstState = await start(actor)
      const secondState = await start(second)
      tokenSubject = randomUUID()
      const subject = tokenSubject
      let exchanges = 0
      let release!: () => void
      const bothExchanging = new Promise<void>((resolve) => {
        release = resolve
      })
      beforeTokenResponse = async () => {
        exchanges++
        if (exchanges === 2) release()
        await bothExchanging
      }
      const responses = await Promise.all([
        finish(actor, firstState),
        finish(second, secondState),
      ])
      expect(
        responses.some(
          (response) =>
            response.status === 302 &&
            response.headers.get('location')?.includes('/settings/connections'),
        ),
        JSON.stringify(
          responses.map((response) => ({
            status: response.status,
            location: response.headers.get('location'),
          })),
        ),
      ).toBe(true)
      const identities = await database.db
        .select()
        .from(account)
        .where(
          and(eq(account.providerId, 'gmail'), eq(account.accountId, subject)),
        )
      expect(identities).toHaveLength(1)
      const firstResult = await outcomes(actor)
      const secondResult =
        owners === 'same owner' ? firstResult : await outcomes(second)
      if (owners === 'different owners') {
        const loser =
          required(identities[0]).userId === actor.userId
            ? secondResult
            : firstResult
        expect(loser).toEqual({ accounts: [], events: [] })
      } else expect(firstResult.events.length).toBeGreaterThanOrEqual(1)
    },
  )

  it('reports a post-commit receipt failure without inventing success or replaying the account write', async () => {
    const actor = await browser()
    const flowId = randomUUID()
    const state = await start(actor, undefined, false, flowId)
    // Isolated database fault injection. No production schema or migration changes.
    await database.pool.query(
      "alter table connector_callback_event add constraint security_test_receipt_fault check (flow_id <> '" +
        flowId +
        "') not valid",
    )
    const response = await finish(actor, state)
    expect(response.status).toBe(500)
    let result = await outcomes(actor)
    expect(result.accounts).toHaveLength(1)
    expect(result.events).toHaveLength(0)
    const id = required(result.accounts[0]).id
    await database.pool.query(
      'alter table connector_callback_event drop constraint security_test_receipt_fault',
    )
    await finish(actor, state)
    result = await outcomes(actor)
    expect(result.accounts.map((row) => row.id)).toEqual([id])
    expect(result.events).toHaveLength(0)
  })
})
