// @vitest-environment node
import { createHash } from 'node:crypto'
import { Effect, Layer, Option, Result } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import {
  AuthTemplateSlug,
  ConnectionName,
  IntegrationSlug,
  OAuthClientSlug,
  Subject,
  Tenant,
  createExecutor,
  type FumaTables,
} from '@executor-js/sdk/core'
import { fumadb } from '@executor-js/fumadb'
import {
  memoryAdapter,
  type MemoryDatabase,
} from '@executor-js/fumadb/adapters/memory'
import { schema } from '@executor-js/fumadb/schema'
import { mcpPlugin } from '@executor-js/plugin-mcp/core'
import { encryptedSecretsPlugin } from '@executor-js/plugin-encrypted-secrets'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { settleOAuthCallback } from '@/routes/api/oauth/callback'
import { ensureServerManagedOAuthClient } from './auth-contract'
import { listServerOwnedExecutorProviders } from './catalog'
import { installProvider } from './install'
import { IntegrationsShDomainSurface } from './integrations-sh'
import { makeExecutorPlugins } from './plugins'

const callbackExecutors = vi.hoisted(() => new Map<string, unknown>())

// Keep callback settlement on the real SDK, replacing only request acquisition.
vi.mock('@/lib/server/executor-runtime', () => ({
  executorProgram: (
    identity: { subject: string },
    run: (executor: unknown) => unknown,
  ) => run(callbackExecutors.get(identity.subject)),
}))

const resource = 'https://workstream.flowresearch.tech/mcp'
const issuer = 'https://identity.flowresearch.tech/realms/flow'
const tokenUrl = `${issuer}/protocol/openid-connect/token`
const callback =
  'https://garden-dev.flow-research.workers.dev/api/oauth/callback'
const resourceScopes = ['workstream:access', 'workstream-mcp-audience']
const scopes = [...resourceScopes, 'offline_access']
const slug = IntegrationSlug.make('workstream')

/** Exercises the installed OAuth/MCP engine and encrypted provider over a shared
 * in-memory FumaDB store. Only provider HTTP is replaced; no live credentials or services. */
describe('Workstream public OAuth lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    callbackExecutors.clear()
  })

  it('installs OAuth through discovery and binds callbacks and refresh to each member', async () => {
    const codes = new Map<
      string,
      { member: string; challenge: string; generation?: number }
    >()
    const refreshes: string[] = []
    const tokenRequests: URLSearchParams[] = []
    const challenges = new Map<string, string>()
    const tokenAuthorizations: (string | null)[] = []
    const accessTokens = new Map<string, string>()
    const refreshTokens = new Map<
      string,
      { member: string; generation: number }
    >()
    const callTokens: string[] = []
    const rejectedAccessTokens: string[] = []
    let revocationAvailable = true
    let pauseRevocation: (() => Promise<void>) | undefined
    let pauseRefresh: ((token: string) => Promise<void>) | undefined
    const http = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init)
      if (request.url.includes('/.well-known/oauth-protected-resource')) {
        return Response.json({
          resource,
          authorization_servers: [issuer],
          scopes_supported: resourceScopes,
        })
      }
      if (request.url === `${issuer}/.well-known/openid-configuration`) {
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
          token_endpoint: tokenUrl,
          response_types_supported: ['code'],
          scopes_supported: scopes,
          code_challenge_methods_supported: ['S256'],
        })
      }
      if (request.url.includes('/.well-known/')) {
        return new Response(null, { status: 404 })
      }
      if (request.url === `${issuer}/protocol/openid-connect/revoke`) {
        if (!revocationAvailable) return new Response(null, { status: 503 })
        const body = new URLSearchParams(await request.text())
        expect(body.get('client_id')).toBe('garden-dev')
        expect(body.get('token_type_hint')).toBe('refresh_token')
        const token = body.get('token') ?? ''
        expect(refreshTokens.has(token)).toBe(true)
        await pauseRevocation?.()
        refreshTokens.delete(token)
        return new Response(null, { status: 200 })
      }
      if (request.url === tokenUrl) {
        const body = new URLSearchParams(await request.text())
        tokenRequests.push(body)
        tokenAuthorizations.push(request.headers.get('authorization'))
        let member: string
        let generation = 0
        if (body.get('grant_type') === 'authorization_code') {
          const code = codes.get(body.get('code') ?? '')
          if (code === undefined)
            return Response.json({ error: 'invalid_grant' }, { status: 400 })
          member = code.member
          generation = code.generation ?? 0
          codes.delete(body.get('code') ?? '')
        } else {
          if (body.get('grant_type') !== 'refresh_token')
            return Response.json(
              { error: 'unsupported_grant_type' },
              { status: 400 },
            )
          const refreshToken = body.get('refresh_token') ?? ''
          await pauseRefresh?.(refreshToken)
          const grant = refreshTokens.get(refreshToken)
          if (grant === undefined)
            return Response.json({ error: 'invalid_grant' }, { status: 400 })
          refreshTokens.delete(refreshToken)
          member = grant.member
          generation = grant.generation + 1
          refreshes.push(member)
        }
        const accessToken = `${member}-access-${generation}`
        const refreshToken = `${member}-refresh-${generation}`
        accessTokens.set(member, accessToken)
        refreshTokens.set(refreshToken, { member, generation })
        return Response.json({
          access_token: accessToken,
          refresh_token: refreshToken,
          token_type: 'Bearer',
          expires_in: 3600,
          scope: scopes.join(' '),
        })
      }
      if (request.url === resource) {
        if (!request.headers.has('authorization')) {
          return Response.json(
            { error: 'unauthorized' },
            {
              status: 401,
              headers: {
                'www-authenticate': `Bearer resource_metadata="https://workstream.flowresearch.tech/.well-known/oauth-protected-resource/mcp"`,
              },
            },
          )
        }
        const bearer = request.headers.get('authorization') ?? ''
        if (
          ![...accessTokens.values()].some(
            (token) => bearer === `Bearer ${token}`,
          )
        ) {
          rejectedAccessTokens.push(bearer)
          return Response.json({ error: 'stale_access_token' }, { status: 401 })
        }
        if (request.method !== 'POST')
          return new Response(null, { status: 405 })
        const message = (await request.json()) as {
          id?: number
          method: string
          params?: { protocolVersion?: string }
        }
        if (message.id === undefined) return new Response(null, { status: 202 })
        let result: object
        if (message.method === 'initialize') {
          result = {
            protocolVersion: message.params?.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: 'workstream-test', version: '1' },
          }
        } else if (message.method === 'tools/list') {
          result = {
            tools: [
              {
                name: 'whoami',
                inputSchema: { type: 'object' },
                annotations: { readOnlyHint: true },
              },
            ],
          }
        } else if (message.method === 'tools/call') {
          callTokens.push(bearer)
          result = {
            content: [
              { type: 'text', text: request.headers.get('authorization') },
            ],
          }
        } else
          return Response.json({
            jsonrpc: '2.0',
            id: message.id,
            error: { code: -32601, message: 'Method not found' },
          })
        return Response.json({ jsonrpc: '2.0', id: message.id, result })
      }
      return Response.json(
        { error: 'Unexpected fixture HTTP target' },
        { status: 400 },
      )
    })
    vi.stubGlobal('fetch', http)

    const stored: MemoryDatabase = {}
    const db = ({ tables }: { tables: FumaTables }) => {
      const version = '1.0.0'
      return fumadb({
        namespace: 'workstream-oauth-test',
        schemas: [schema({ version, tables })],
      })
        .client(memoryAdapter({ db: stored }))
        .orm<string>(version)
    }
    const plugins = makeExecutorPlugins(
      'workstream-oauth-test-encryption-key',
      { fetch: http },
    )
    const open = (member: string) =>
      createExecutor({
        tenant: Tenant.make('workspace-a'),
        subject: Subject.make(member),
        db,
        plugins,
        fetch: http,
        httpClientLayer: FetchHttpClient.layer.pipe(
          Layer.provide(Layer.succeed(FetchHttpClient.Fetch, http)),
        ),
        redirectUri: callback,
        onElicitation: 'accept-all',
      })
    const members = await Effect.runPromise(
      Effect.all([open('member-a'), open('member-b')]),
    )
    const [alice, bob] = members
    callbackExecutors.set('member-a', alice)
    callbackExecutors.set('member-b', bob)
    await Effect.runPromise(
      Effect.gen(function* () {
        const provider = listServerOwnedExecutorProviders().find(
          (candidate) => String(candidate.installSlug) === 'workstream',
        )
        expect(provider).toBeDefined()
        if (provider === undefined) return
        const installed = yield* installProvider(
          alice,
          provider,
          IntegrationsShDomainSurface.make({
            domain: 'workstream.flowresearch.tech',
            description: Option.none(),
            summary: Option.none(),
            surfaces: [],
          }),
          'mcp',
        )
        expect(installed).toMatchObject({
          kind: 'oauth_ready',
          slug: 'workstream',
          connectUrl: '/api/executor/oauth/start?integration=workstream',
        })
        const integration = yield* alice.integrations.get(slug)
        expect(integration).not.toBeNull()
        if (integration === null) return
        const method = integration.authMethods[0]
        expect(method).toBeDefined()
        if (method === undefined) return
        const managed = yield* ensureServerManagedOAuthClient(
          alice.oauth,
          integration,
          method,
          {
            WORKSTREAM_MCP_CLIENT_ID: 'garden-dev',
          },
        )
        expect(managed._tag).toBe('Some')
        if (managed._tag !== 'Some') return
        for (const [member, executor] of [
          ['member-a', alice],
          ['member-b', bob],
        ] as const) {
          const flow = yield* executor.oauth.start({
            client: managed.value.slug,
            clientOwner: 'org',
            owner: 'user',
            name: ConnectionName.make('Workstream'),
            integration: slug,
            template: AuthTemplateSlug.make('oauth2'),
            redirectUri: callback,
          })
          expect(flow.status).toBe('redirect')
          if (flow.status !== 'redirect') return
          const authorization = new URL(flow.authorizationUrl)
          expect(authorization.searchParams.get('code_challenge_method')).toBe(
            'S256',
          )
          expect(authorization.searchParams.get('resource')).toBe(resource)
          expect(authorization.searchParams.get('scope')?.split(' ')).toEqual(
            scopes,
          )
          challenges.set(
            member,
            authorization.searchParams.get('code_challenge') ?? '',
          )
          codes.set(member, {
            member,
            challenge: authorization.searchParams.get('code_challenge') ?? '',
          })
          if (member === 'member-a') {
            const foreignCallback = yield* Effect.result(
              bob.oauth.complete({ state: flow.state, code: member }),
            )
            expect(Result.isFailure(foreignCallback)).toBe(true)
            expect(tokenRequests).toHaveLength(0)
          }
          const settled = yield* settleOAuthCallback({
            identity: { tenant: 'workspace-a', subject: member },
            state: flow.state,
            code: member,
            providerError: null,
            providerErrorDescription: null,
            callbackDomain:
              member === 'member-a'
                ? 'workstream.flowresearch.tech'
                : 'malicious.flowresearch.tech',
          })
          expect(settled).toEqual({ ok: true })
          const connection = (yield* executor.connections.list({
            integration: slug,
          }))[0]
          expect(connection).toBeDefined()
          if (connection === undefined) return
          expect(connection.owner).toBe('user')
          expect(connection.provider).toBe('encrypted')
          const replay = yield* Effect.result(
            executor.oauth.complete({ state: flow.state, code: member }),
          )
          expect(Result.isFailure(replay)).toBe(true)
          const visible = yield* executor.connections.list({
            integration: slug,
          })
          expect(visible).toHaveLength(1)
          expect(visible[0]?.owner).toBe('user')
        }
        expect(yield* alice.oauth.listClients()).toHaveLength(1)
        expect(yield* bob.oauth.listClients()).toHaveLength(1)
        for (const member of ['member-a', 'member-b']) {
          expect(JSON.stringify(stored)).not.toContain(`${member}-access`)
          expect(JSON.stringify(stored)).not.toContain(`${member}-refresh`)
        }
        const restoredBob = yield* open('member-b')
        members.push(restoredBob)
        const aliceTools = yield* alice.tools.list({ integration: slug })
        const bobTools = yield* restoredBob.tools.list({ integration: slug })
        expect(aliceTools).toHaveLength(1)
        expect(bobTools).toHaveLength(1)
        const aliceTool = aliceTools[0]
        const bobTool = bobTools[0]
        if (aliceTool === undefined || bobTool === undefined) return
        const now = Date.now()
        const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 3601_000)
        const bobBeforeRefresh = yield* restoredBob.connections.list({
          integration: slug,
        })
        expect(
          JSON.stringify(yield* alice.execute(aliceTool.address, {})),
        ).toContain('member-a-access-1')
        expect(refreshes).toEqual(['member-a'])
        expect(
          yield* restoredBob.connections.list({ integration: slug }),
        ).toEqual(bobBeforeRefresh)

        yield* alice.close()
        members.splice(members.indexOf(alice), 1)
        const restoredAlice = yield* open('member-a')
        members.push(restoredAlice)
        expect(
          JSON.stringify(yield* restoredAlice.execute(aliceTool.address, {})),
        ).toContain('member-a-access-1')
        expect(refreshes).toEqual(['member-a'])

        // Stagger the members' renewals so Alice's second expiry cannot also
        // expire Bob's refreshed token during the isolation assertion.
        clock.mockReturnValue(now + 5401_000)
        expect(
          JSON.stringify(yield* restoredBob.execute(bobTool.address, {})),
        ).toContain('member-b-access-1')
        expect(refreshes).toEqual(['member-a', 'member-b'])
        const bobAfterRefresh = yield* restoredBob.connections.list({
          integration: slug,
        })
        clock.mockReturnValue(now + 7202_000)
        expect(
          JSON.stringify(yield* restoredAlice.execute(aliceTool.address, {})),
        ).toContain('member-a-access-2')
        expect(refreshes).toEqual(['member-a', 'member-b', 'member-a'])
        expect(
          yield* restoredBob.connections.list({ integration: slug }),
        ).toEqual(bobAfterRefresh)
        expect(tokenRequests).toHaveLength(5)
        expect(tokenAuthorizations).toEqual([null, null, null, null, null])
        for (const body of tokenRequests) {
          expect(body.get('client_id')).toBe('garden-dev')
          expect(body.has('client_secret')).toBe(false)
          expect(body.get('resource')).toBe(resource)
        }
        const codeRequests = tokenRequests.filter(
          (body) => body.get('grant_type') === 'authorization_code',
        )
        expect(codeRequests).toHaveLength(2)
        for (const body of codeRequests) {
          expect(body.get('redirect_uri')).toBe(callback)
          expect(
            createHash('sha256')
              .update(body.get('code_verifier') ?? '')
              .digest('base64url'),
          ).toBe(challenges.get(body.get('code') ?? ''))
        }
        const refreshRequests = tokenRequests.filter(
          (body) => body.get('grant_type') === 'refresh_token',
        )
        expect(refreshRequests.map((body) => body.get('scope'))).toEqual([
          scopes.join(' '),
          scopes.join(' '),
          scopes.join(' '),
        ])
        expect(
          refreshRequests.map((body) => body.get('refresh_token')),
        ).toEqual([
          'member-a-refresh-0',
          'member-b-refresh-0',
          'member-a-refresh-1',
        ])
        for (const member of ['member-a', 'member-b']) {
          expect(JSON.stringify(stored)).not.toContain(`${member}-access`)
          expect(JSON.stringify(stored)).not.toContain(`${member}-refresh`)
        }
        const ref = (yield* restoredAlice.connections.list({
          integration: slug,
        }))[0]
        expect(ref).toBeDefined()
        if (ref === undefined) return
        revocationAvailable = false
        const unavailableRemoval = yield* restoredAlice.connections
          .remove(ref)
          .pipe(Effect.result)
        expect(Result.isFailure(unavailableRemoval)).toBe(true)
        expect(
          yield* restoredAlice.connections.list({ integration: slug }),
        ).toHaveLength(1)
        expect(refreshTokens.has('member-a-refresh-2')).toBe(true)
        revocationAvailable = true
        yield* restoredAlice.connections.remove(ref)
        expect(refreshTokens.has('member-a-refresh-2')).toBe(false)
        expect(refreshTokens.has('member-b-refresh-1')).toBe(true)
        expect(
          yield* restoredAlice.connections.list({ integration: slug }),
        ).toEqual([])
        expect(yield* bob.connections.list({ integration: slug })).toHaveLength(
          1,
        )
        expect(
          JSON.stringify(yield* restoredBob.execute(bobTool.address, {})),
        ).toContain('member-b-access-1')
        expect(refreshes).toEqual(['member-a', 'member-b', 'member-a'])
        expect(callTokens).toEqual([
          'Bearer member-a-access-1',
          'Bearer member-a-access-1',
          'Bearer member-b-access-1',
          'Bearer member-a-access-2',
          'Bearer member-b-access-1',
        ])
        expect(rejectedAccessTokens).toEqual([])
        refreshTokens.delete('member-b-refresh-1')
        clock.mockReturnValue(now + 10803_000)
        const rejectedCall = yield* restoredBob
          .execute(bobTool.address, {})
          .pipe(Effect.result)
        expect(Result.isFailure(rejectedCall)).toBe(true)
        const retained = Object.values(stored)
          .flat()
          .find(
            (row) =>
              row.subject === 'member-b' &&
              row.integration === 'workstream' &&
              'refresh_item_id' in row,
          )
        expect(retained).toBeDefined()
        if (retained === undefined) return
        retained.last_health = {
          status: 'degraded',
          checkedAt: now + 10804_000,
          detail: 'Catalogue unavailable',
        }
        const expiredConnections = yield* restoredBob.connections.list({
          integration: slug,
        })
        expect(expiredConnections).toHaveLength(1)
        expect(expiredConnections[0]?.lastHealth?.status).toBe('expired')

        const reconnectAlice = (generation: number) =>
          Effect.gen(function* () {
            const flow = yield* restoredAlice.oauth.start({
              client: managed.value.slug,
              clientOwner: 'org',
              owner: 'user',
              name: ConnectionName.make('Workstream'),
              integration: slug,
              template: AuthTemplateSlug.make('oauth2'),
              redirectUri: callback,
            })
            if (flow.status !== 'redirect')
              throw new Error('Expected Workstream OAuth redirect')
            const code = `alice-reconnect-${generation}`
            codes.set(code, {
              member: 'member-a',
              challenge:
                new URL(flow.authorizationUrl).searchParams.get(
                  'code_challenge',
                ) ?? '',
              generation,
            })
            return yield* restoredAlice.oauth.complete({
              state: flow.state,
              code,
            })
          })
        const currentGrant = yield* reconnectAlice(100)
        const revocationStarted = Promise.withResolvers<void>()
        const finishRevocation = Promise.withResolvers<void>()
        pauseRevocation = () => {
          revocationStarted.resolve()
          return finishRevocation.promise
        }
        const removing = Effect.runPromise(
          restoredAlice.connections.remove(currentGrant).pipe(Effect.result),
        )
        yield* Effect.promise(() => revocationStarted.promise)
        const renewedGrant = yield* reconnectAlice(200).pipe(
          Effect.ensuring(Effect.sync(() => finishRevocation.resolve())),
        )
        expect(Result.isFailure(yield* Effect.promise(() => removing))).toBe(
          true,
        )
        pauseRevocation = undefined
        expect(refreshTokens.has('member-a-refresh-100')).toBe(false)
        expect(refreshTokens.has('member-a-refresh-200')).toBe(true)
        expect(
          yield* restoredAlice.connections.list({ integration: slug }),
        ).toHaveLength(1)
        expect(
          JSON.stringify(yield* restoredAlice.execute(aliceTool.address, {})),
        ).toContain('member-a-access-200')

        const refreshStarted = Promise.withResolvers<void>()
        const finishRefresh = Promise.withResolvers<void>()
        pauseRefresh = (token) => {
          if (token !== 'member-a-refresh-200') return Promise.resolve()
          refreshStarted.resolve()
          return finishRefresh.promise
        }
        refreshTokens.delete('member-a-refresh-200')
        clock.mockReturnValue(now + 14405_000)
        const staleRefresh = Effect.runPromise(
          restoredAlice.connections.checkHealth(renewedGrant),
        )
        yield* Effect.promise(() => refreshStarted.promise)
        const replacementGrant = yield* reconnectAlice(300).pipe(
          Effect.ensuring(Effect.sync(() => finishRefresh.resolve())),
        )
        expect((yield* Effect.promise(() => staleRefresh)).status).toBe(
          'expired',
        )
        const afterStaleRefresh = yield* restoredAlice.connections.list({
          integration: slug,
        })
        expect(afterStaleRefresh[0]?.lastHealth?.status).not.toBe('expired')
        expect(
          JSON.stringify(yield* restoredAlice.execute(aliceTool.address, {})),
        ).toContain('member-a-access-300')

        const storedClients = Object.values(stored).find((rows) =>
          rows.some((row) => row.client_id === 'garden-dev'),
        )
        if (storedClients === undefined)
          throw new Error('Expected the stored Garden OAuth client')
        storedClients.splice(
          storedClients.findIndex((row) => row.client_id === 'garden-dev'),
          1,
        )
        const callsBeforeMissingBinding = http.mock.calls.length
        const failedRemoval = yield* restoredAlice.connections
          .remove(replacementGrant)
          .pipe(Effect.result)
        expect(Result.isFailure(failedRemoval)).toBe(true)
        expect(http.mock.calls).toHaveLength(callsBeforeMissingBinding)
        expect(refreshTokens.has('member-a-refresh-300')).toBe(true)
        expect(
          yield* restoredAlice.connections.list({ integration: slug }),
        ).toHaveLength(1)
      }),
    ).finally(async () => {
      await Effect.runPromise(
        Effect.forEach(members, (executor) => executor.close()),
      )
    })
  })

  it('retains regional callback token endpoints for other providers', async () => {
    const regionalResource = 'https://mcp.provider.example/mcp'
    const regionalTokenUrl = 'https://eu.provider.example/token'
    const exchanges: string[] = []
    const http = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init)
      if (request.url.includes('/.well-known/')) {
        return Response.json({
          resource: regionalResource,
          authorization_servers: ['https://auth.provider.example'],
          scopes_supported: ['read'],
        })
      }
      if (request.method === 'POST' && request.url.endsWith('/token')) {
        exchanges.push(request.url)
        return Response.json({
          access_token: 'regional-access',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'read',
        })
      }
      return new Response(null, { status: 405 })
    })
    vi.stubGlobal('fetch', http)
    await Effect.runPromise(
      Effect.acquireUseRelease(
        createExecutor({
          tenant: Tenant.make('regional-workspace'),
          subject: Subject.make('regional-member'),
          plugins: [
            mcpPlugin({ fetch: http }),
            encryptedSecretsPlugin({ key: 'regional-test-key' }),
          ],
          fetch: http,
          httpClientLayer: FetchHttpClient.layer.pipe(
            Layer.provide(Layer.succeed(FetchHttpClient.Fetch, http)),
          ),
          redirectUri: callback,
          onElicitation: 'accept-all',
        }),
        (executor) =>
          Effect.gen(function* () {
            yield* executor.mcp.addServer({
              slug: 'regional',
              name: 'Regional',
              endpoint: regionalResource,
              authenticationTemplate: [{ slug: 'oauth2', kind: 'oauth2' }],
            })
            const client = yield* executor.oauth.createClient({
              owner: 'org',
              slug: OAuthClientSlug.make('regional'),
              grant: 'authorization_code',
              authorizationUrl: 'https://auth.provider.example/authorize',
              tokenUrl: 'https://auth.provider.example/token',
              resource: regionalResource,
              clientId: 'regional-client',
              clientSecret: '',
            })
            const flow = yield* executor.oauth.start({
              client,
              clientOwner: 'org',
              owner: 'user',
              integration: IntegrationSlug.make('regional'),
              template: AuthTemplateSlug.make('oauth2'),
              name: ConnectionName.make('Regional'),
            })
            expect(flow.status).toBe('redirect')
            if (flow.status !== 'redirect') return
            yield* executor.oauth.complete({
              state: flow.state,
              code: 'regional-code',
              callbackDomain: 'eu.provider.example',
            })
            expect(exchanges).toEqual([regionalTokenUrl])
          }),
        (executor) => executor.close(),
      ),
    )
  })
})
