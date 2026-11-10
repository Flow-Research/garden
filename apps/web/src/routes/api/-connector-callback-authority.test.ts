// @vitest-environment node
import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { Effect } from 'effect'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import * as schema from '@garden/db/schema'
import { startTestDb, type TestDb } from '@garden/db/testing'
import { createDiscordSetupState } from '@garden/connectors/discord/install'
import { createAppRequestContext } from '@/lib/server/context'
import { bindAppEnv, type AppEnv } from '@/lib/server/env'
import { createGitHubSetupState } from '@/lib/server/github-app'
import { Route as GitHubSetup } from './github/setup'
import { Route as DiscordSetup } from './discord/setup'
import {
  authTestOrigin as origin,
  seedWorkspaceActor,
  workspaceTestEnv,
  TEST_DB_HOOK_TIMEOUT_MS,
  type WorkspaceRole,
} from './-callback-auth-fixture'
import { invokeRouteHandler } from '@/test/route-handler'

const providers = ['github', 'discord'] as const
type Provider = (typeof providers)[number]
const routes = {
  github: GitHubSetup,
  discord: DiscordSetup,
}

describe('connector callback authority (Postgres + Better Auth)', () => {
  let testDb: TestDb
  let env: AppEnv
  const http = vi.fn<typeof fetch>()

  beforeAll(async () => {
    testDb = await startTestDb()
    env = workspaceTestEnv(testDb.databaseUrl)
    // Ephemeral signing material, never live GitHub credentials.
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    })
    Object.assign(env, {
      GITHUB_APP_ID: 'test-app',
      GITHUB_APP_SLUG: 'garden-authority-test',
      GITHUB_APP_PRIVATE_KEY: privateKey,
      DISCORD_CLIENT_ID: 'test-client',
      DISCORD_CLIENT_SECRET: 'test-client-secret',
      DISCORD_BOT_TOKEN: 'test-bot-token',
    })
  }, TEST_DB_HOOK_TIMEOUT_MS)

  beforeEach(() => {
    env.ENVIRONMENT = 'test'
    bindAppEnv(env)
    // Mock exception: only provider HTTP is replaced; unexpected egress fails.
    http.mockReset().mockImplementation(async () => {
      throw new Error('Unexpected provider HTTP request')
    })
    vi.stubGlobal('fetch', http)
  })

  afterEach(() => vi.unstubAllGlobals())
  afterAll(async () => testDb?.cleanup(), TEST_DB_HOOK_TIMEOUT_MS)

  const seedActor = (role: WorkspaceRole | null = 'member') =>
    seedWorkspaceActor(testDb.db, env, role)
  type Actor = Awaited<ReturnType<typeof seedActor>>

  /** The real Start handlers receive a real request-scoped auth/DB context. */
  async function invoke(
    provider: Provider,
    actor: Actor,
    query: Record<string, string> = {},
  ) {
    const pathname = `/api/${provider}/setup`
    const url = new URL(pathname, origin)
    url.search = new URLSearchParams(query).toString()
    const request = new Request(url, {
      headers: { cookie: actor.cookie, 'X-Workspace-ID': actor.workspaceId },
    })
    const context = createAppRequestContext(env, request)
    return invokeRouteHandler(routes[provider], 'GET', {
      request,
      context,
    }).finally(() => context.close())
  }

  /** Sign state with production functions, so identity/workspace tampering is real. */
  async function callbackQuery(provider: Provider, actor: Actor) {
    const input = {
      secret: env.BETTER_AUTH_SECRET,
      userId: actor.userId,
      workspaceId: actor.workspaceId,
    }
    const state =
      provider === 'github'
        ? await createGitHubSetupState(input)
        : await Effect.runPromise(createDiscordSetupState(input))
    return {
      state,
      installation_id: '123',
      code: 'fixture-code',
      guild_id: '456',
    }
  }

  /** Snapshot all callback-owned writes, including indirect capability and grant changes. */
  async function writes() {
    return Promise.all([
      testDb.db
        .select()
        .from(schema.githubAppInstallation)
        .orderBy(schema.githubAppInstallation.id),
      testDb.db
        .select()
        .from(schema.discordBotInstallation)
        .orderBy(schema.discordBotInstallation.id),
      testDb.db
        .select()
        .from(schema.connectorCallbackEvent)
        .orderBy(schema.connectorCallbackEvent.id),
      testDb.db.select().from(schema.capability).orderBy(schema.capability.id),
      testDb.db
        .select()
        .from(schema.permissionGrant)
        .orderBy(schema.permissionGrant.id),
      testDb.db
        .select()
        .from(schema.connectionGrant)
        .orderBy(schema.connectionGrant.id),
    ])
  }

  const membership = (actor: Actor) =>
    and(
      eq(schema.member.organizationId, actor.workspaceId),
      eq(schema.member.userId, actor.userId),
    )

  it('requires a matching browser session outside development', async () => {
    const actor = await seedActor('owner')
    const other = await seedActor('owner')
    const query = await callbackQuery('github', actor)
    const before = await writes()
    expect(
      (await invoke('github', { ...actor, cookie: '' }, query)).status,
    ).toBe(401)
    expect((await invoke('github', other, query)).status).toBe(401)
    expect(await writes()).toEqual(before)
    expect(http).not.toHaveBeenCalled()
  })

  describe.each(providers)('%s', (provider) => {
    it.each(['test', 'development'] as const)(
      'rejects a signed callback from a member in %s before any side effects',
      async (environment) => {
        env.ENVIRONMENT = environment
        const actor = await seedActor()
        const query = await callbackQuery(provider, actor)
        const before = await writes()
        expect((await invoke(provider, actor, query)).status).toBe(403)
        expect(await writes()).toEqual(before)
        expect(http).not.toHaveBeenCalled()
      },
    )

    it.each(['demoted', 'removed'] as const)(
      'rejects an owner %s after state issuance',
      async (change) => {
        const actor = await seedActor('owner')
        const { state } = await callbackQuery(provider, actor)
        if (change === 'demoted') {
          await testDb.db
            .update(schema.member)
            .set({ role: 'member' })
            .where(membership(actor))
        } else {
          await testDb.db.delete(schema.member).where(membership(actor))
        }
        const before = await writes()
        const response = await invoke(provider, actor, {
          state,
          installation_id: '123',
          code: 'fixture-code',
        })
        expect(response.status).toBe(change === 'demoted' ? 403 : 401)
        expect(await writes()).toEqual(before)
        expect(http).not.toHaveBeenCalled()
      },
    )

    it('does not substitute a browser actor for the signed actor', async () => {
      const owner = await seedActor('owner')
      const member = await seedActor('member')
      const query = await callbackQuery(provider, member)
      const before = await writes()
      // GitHub keeps its existing matching-session check. Discord has no cookie requirement.
      expect((await invoke(provider, owner, query)).status).toBe(
        provider === 'github' ? 401 : 403,
      )
      expect(await writes()).toEqual(before)
      expect(http).not.toHaveBeenCalled()
    })

    it('checks the signed workspace, not an owned workspace in the request header', async () => {
      const actor = await seedActor('owner')
      const other = await seedActor('owner')
      await testDb.db.insert(schema.member).values({
        id: randomUUID(),
        userId: actor.userId,
        organizationId: other.workspaceId,
        role: 'member',
        createdAt: new Date(),
      })
      const query = await callbackQuery(provider, {
        ...actor,
        workspaceId: other.workspaceId,
      })
      const before = await writes()
      expect((await invoke(provider, actor, query)).status).toBe(403)
      expect(await writes()).toEqual(before)
      expect(http).not.toHaveBeenCalled()
    })

    it.each(['userId', 'workspaceId'] as const)(
      'rejects a changed signed %s before any side effects',
      async (field) => {
        const actor = await seedActor('owner')
        const query = await callbackQuery(provider, actor)
        const [payload, signature] = query.state.split('.')
        if (!payload || !signature) throw new Error('Expected signed state')
        const changedPayload = Buffer.from(payload, 'base64url')
          .toString('utf8')
          .replace(actor[field], randomUUID())
        const before = await writes()
        expect(
          (
            await invoke(provider, actor, {
              ...query,
              state: `${Buffer.from(changedPayload).toString('base64url')}.${signature}`,
            })
          ).status,
        ).toBe(400)
        expect(await writes()).toEqual(before)
        expect(http).not.toHaveBeenCalled()
      },
    )

    it.each([
      { role: 'owner', environment: 'test' },
      { role: 'admin', environment: 'test' },
      { role: 'owner', environment: 'development' },
      { role: 'admin', environment: 'development' },
    ] as const)(
      'lets a current $role persist the installation and default grants in $environment',
      async ({ role, environment }) => {
        const actor = await seedActor(role)
        const agentId = randomUUID()
        await testDb.db.insert(schema.agent).values({
          id: agentId,
          workspaceId: actor.workspaceId,
          ownerUserId: actor.userId,
          name: 'Install consumer',
        })
        const query = await callbackQuery(provider, actor)
        // Only the external HTTP boundary is simulated. Signing, callback persistence,
        // capability discovery, and default grant writes use production code.
        http.mockImplementation(async (input) => {
          const url = new URL(
            input instanceof Request ? input.url : String(input),
          )
          if (url.href === 'https://api.github.com/app/installations/123') {
            return Response.json({
              account: { login: 'fixture-org' },
              repository_selection: 'selected',
            })
          }
          if (url.href === 'https://discord.com/api/v10/oauth2/token') {
            return Response.json({
              access_token: 'fixture-access',
              token_type: 'Bearer',
              expires_in: 3600,
              scope: 'bot identify',
              guild: { id: '456', name: 'Fixture guild' },
            })
          }
          if (url.href === 'https://discord.com/api/v10/guilds/456') {
            return Response.json({ id: '456', name: 'Fixture guild' })
          }
          throw new Error(
            `Unexpected provider URL: ${url.origin}${url.pathname}`,
          )
        })
        env.ENVIRONMENT = environment
        const callbackActor = {
          ...actor,
          cookie:
            provider === 'github' && environment === 'test' ? actor.cookie : '',
        }
        const response = await invoke(provider, callbackActor, query)
        expect(response.status).toBe(302)
        const installations =
          provider === 'github'
            ? await testDb.db
                .select()
                .from(schema.githubAppInstallation)
                .where(
                  eq(
                    schema.githubAppInstallation.workspaceId,
                    actor.workspaceId,
                  ),
                )
            : await testDb.db
                .select()
                .from(schema.discordBotInstallation)
                .where(
                  eq(
                    schema.discordBotInstallation.workspaceId,
                    actor.workspaceId,
                  ),
                )
        expect(installations).toEqual([
          expect.objectContaining({
            workspaceId: actor.workspaceId,
            connectedBy: actor.userId,
            status: 'connected',
          }),
        ])
        const grants = await testDb.db
          .select({ grantedBy: schema.permissionGrant.grantedBy })
          .from(schema.permissionGrant)
          .where(eq(schema.permissionGrant.agentId, agentId))
        expect(grants.length).toBeGreaterThan(0)
        expect(grants.every((grant) => grant.grantedBy === actor.userId)).toBe(
          true,
        )
        expect(http).toHaveBeenCalledTimes(provider === 'github' ? 1 : 2)
      },
    )
  })
})
