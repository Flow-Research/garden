// @vitest-environment node
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { Deferred, Effect, Layer, Option, Result } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import {
  AuthTemplateSlug,
  ConnectionName,
  IntegrationSlug,
  OAuthClientSlug,
  ProviderKey,
  Subject,
  Tenant,
  collectTables,
  createExecutor,
  type FumaTables,
} from '@executor-js/sdk/core'
import { makeHostedFetch } from '@executor-js/sdk/host-internal'
import { mcpPlugin } from '@executor-js/plugin-mcp/core'
import { encryptedSecretsPlugin } from '@executor-js/plugin-encrypted-secrets'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { settleOAuthCallback } from '@/routes/api/oauth/callback'
import { sqliteD1 } from '@/test/executor-sqlite-d1'
import { ensureServerManagedOAuthClient } from './auth-contract'
import { listServerOwnedExecutorProviders } from './catalog'
import { installProvider } from './install'
import { IntegrationsShDomainSurface } from './integrations-sh'
import { makeExecutorPlugins } from './plugins'
import { createD1ExecutorDb } from './d1'

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

/** Exercises the SDK and encrypted provider through the production D1 adapter over SQLite. */
describe('Workstream public OAuth lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    callbackExecutors.clear()
  })

  it('does not follow a manual revocation redirect or forward its credential', async () => {
    const http = vi.fn<typeof fetch>(
      async () =>
        new Response(null, {
          status: 307,
          headers: { location: 'https://other.example/revoke' },
        }),
    )
    const guardedFetch = makeHostedFetch({
      fetch: http,
      resolveHostname: async () => [{ address: '93.184.216.34', family: 4 }],
    })
    const response = await guardedFetch(
      `${issuer}/protocol/openid-connect/revoke`,
      {
        method: 'POST',
        redirect: 'manual',
        body: new URLSearchParams({ token: 'fixture-refresh-token' }),
      },
    )
    expect(response.status).toBe(307)
    expect(response.ok).toBe(false)
    expect(http).toHaveBeenCalledTimes(1)
    expect(http.mock.calls[0]?.[0]).toBe(
      `${issuer}/protocol/openid-connect/revoke`,
    )
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
      { member: string; generation: number; grantId: string }
    >()
    const refreshGrantIds = new Map<string, string>()
    const callTokens: string[] = []
    const rejectedAccessTokens: string[] = []
    const revocationRedirects: RequestRedirect[] = []
    let revocationStatus = 200
    let pauseRevocation: (() => Promise<void>) | undefined
    let pauseRefresh: ((token: string) => Promise<void>) | undefined
    let pauseRefreshResponse: ((token: string) => Promise<void>) | undefined
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
        revocationRedirects.push(request.redirect)
        if (revocationStatus !== 200) {
          return new Response(null, {
            status: revocationStatus,
            headers: { location: 'https://other.example/revoke' },
          })
        }
        const body = new URLSearchParams(await request.text())
        expect(body.get('client_id')).toBe('garden-dev')
        expect(body.get('token_type_hint')).toBe('refresh_token')
        const token = body.get('token') ?? ''
        await pauseRevocation?.()
        const grantId = refreshGrantIds.get(token)
        for (const [refreshToken, grant] of refreshTokens) {
          if (grant.grantId === grantId) refreshTokens.delete(refreshToken)
        }
        return new Response(null, { status: 200 })
      }
      if (request.url === tokenUrl) {
        const body = new URLSearchParams(await request.text())
        tokenRequests.push(body)
        tokenAuthorizations.push(request.headers.get('authorization'))
        let member: string
        let grantId: string
        let rotatedFrom: string | undefined
        let generation = 0
        if (body.get('grant_type') === 'authorization_code') {
          grantId = body.get('code') ?? ''
          const code = codes.get(grantId)
          if (code === undefined)
            return Response.json({ error: 'invalid_grant' }, { status: 400 })
          member = code.member
          generation = code.generation ?? 0
          codes.delete(grantId)
        } else {
          if (body.get('grant_type') !== 'refresh_token')
            return Response.json(
              { error: 'unsupported_grant_type' },
              { status: 400 },
            )
          const refreshToken = body.get('refresh_token') ?? ''
          rotatedFrom = refreshToken
          await pauseRefresh?.(refreshToken)
          const grant = refreshTokens.get(refreshToken)
          if (grant === undefined)
            return Response.json({ error: 'invalid_grant' }, { status: 400 })
          refreshTokens.delete(refreshToken)
          member = grant.member
          grantId = grant.grantId
          generation = grant.generation + 1
          refreshes.push(member)
        }
        const accessToken = `${member}-access-${generation}`
        const refreshToken = `${member}-refresh-${generation}`
        accessTokens.set(grantId, accessToken)
        refreshTokens.set(refreshToken, { member, generation, grantId })
        refreshGrantIds.set(refreshToken, grantId)
        if (rotatedFrom) await pauseRefreshResponse?.(rotatedFrom)
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

    const sqlite = new DatabaseSync(':memory:')
    onTestFinished(() => sqlite.close())
    const { connection, oauth_client, plugin_storage } = collectTables()
    if (!connection || !oauth_client || !plugin_storage)
      throw new Error('Missing Executor tables')
    const inspectSecrets = () =>
      sqlite
        .prepare(`select data from "${plugin_storage.names.sql}"`)
        .all()
        .map((row) => {
          if (!(row.data instanceof Uint8Array))
            throw new Error('Expected credential data in a SQLite BLOB')
          return Buffer.from(row.data).toString('utf8')
        })
        .join(' ')
    const db = ({ tables }: { tables: FumaTables }) =>
      createD1ExecutorDb(sqliteD1(sqlite), tables)
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
          expect(inspectSecrets()).not.toContain(`${member}-access`)
          expect(inspectSecrets()).not.toContain(`${member}-refresh`)
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
        const aliceCredentialIds = restoredAlice.providers
          .items(ProviderKey.make('encrypted'))
          .pipe(Effect.map((items) => items.map((item) => item.id).sort()))
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
          expect(inspectSecrets()).not.toContain(`${member}-access`)
          expect(inspectSecrets()).not.toContain(`${member}-refresh`)
        }
        const ref = (yield* restoredAlice.connections.list({
          integration: slug,
        }))[0]
        expect(ref).toBeDefined()
        if (ref === undefined) return
        const storedBeforeRemoval = yield* aliceCredentialIds
        expect(storedBeforeRemoval).toHaveLength(2)
        for (const status of [503, 307]) {
          revocationStatus = status
          const unavailableRemoval = yield* restoredAlice.connections
            .remove(ref)
            .pipe(Effect.result)
          expect(Result.isFailure(unavailableRemoval)).toBe(true)
          expect(
            yield* restoredAlice.connections.list({ integration: slug }),
          ).toHaveLength(1)
          expect(refreshTokens.has('member-a-refresh-2')).toBe(true)
          expect(yield* aliceCredentialIds).toEqual(storedBeforeRemoval)
        }
        revocationStatus = 200
        sqlite.exec(
          `create trigger reject_disconnect before delete on "${connection.names.sql}" when old.subject = 'member-a' begin select raise(abort, 'fixture disconnect write failure'); end`,
        )
        const failedLocalRemoval = yield* restoredAlice.connections
          .remove(ref)
          .pipe(Effect.result)
        expect(Result.isFailure(failedLocalRemoval)).toBe(true)
        expect(refreshTokens.has('member-a-refresh-2')).toBe(false)
        expect(yield* aliceCredentialIds).toEqual(storedBeforeRemoval)
        expect(
          yield* restoredAlice.connections.list({ integration: slug }),
        ).toHaveLength(1)
        sqlite.exec('drop trigger reject_disconnect')
        yield* restoredAlice.connections.remove(ref)
        expect(refreshTokens.has('member-a-refresh-2')).toBe(false)
        expect(refreshTokens.has('member-b-refresh-1')).toBe(true)
        expect(yield* aliceCredentialIds).toEqual([])
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
        const retained = sqlite
          .prepare(
            `update "${connection.names.sql}" set last_health = ? where subject = 'member-b' and integration = 'workstream'`,
          )
          .run(
            Buffer.from(
              JSON.stringify({
                status: 'degraded',
                checkedAt: now + 10804_000,
                detail: 'Catalogue unavailable',
              }),
            ),
          )
        expect(retained.changes).toBe(1)
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
        const supersededIds = yield* aliceCredentialIds
        expect(supersededIds).toHaveLength(2)
        const revocationStarted = yield* Deferred.make<void>()
        const finishRevocation = yield* Deferred.make<void>()
        pauseRevocation = () => {
          return Effect.runPromise(
            Deferred.succeed(revocationStarted, undefined).pipe(
              Effect.andThen(Deferred.await(finishRevocation)),
            ),
          )
        }
        const removing = Effect.runPromise(
          restoredAlice.connections.remove(currentGrant).pipe(Effect.result),
        )
        yield* Deferred.await(revocationStarted)
        const renewedGrant = yield* reconnectAlice(200).pipe(
          Effect.ensuring(Deferred.succeed(finishRevocation, undefined)),
        )
        expect(Result.isFailure(yield* Effect.promise(() => removing))).toBe(
          true,
        )
        pauseRevocation = undefined
        expect(refreshTokens.has('member-a-refresh-100')).toBe(false)
        expect(refreshTokens.has('member-a-refresh-200')).toBe(true)
        const renewedIds = yield* aliceCredentialIds
        expect(renewedIds).toHaveLength(2)
        expect(renewedIds.filter((id) => supersededIds.includes(id))).toEqual(
          [],
        )
        expect(
          yield* restoredAlice.connections.list({ integration: slug }),
        ).toHaveLength(1)
        expect(
          JSON.stringify(yield* restoredAlice.execute(aliceTool.address, {})),
        ).toContain('member-a-access-200')

        const refreshStarted = yield* Deferred.make<void>()
        const finishRefresh = yield* Deferred.make<void>()
        pauseRefresh = (token) => {
          if (token !== 'member-a-refresh-200') return Promise.resolve()
          return Effect.runPromise(
            Deferred.succeed(refreshStarted, undefined).pipe(
              Effect.andThen(Deferred.await(finishRefresh)),
            ),
          )
        }
        refreshTokens.delete('member-a-refresh-200')
        clock.mockReturnValue(now + 14405_000)
        const staleRefresh = Effect.runPromise(
          restoredAlice.connections.checkHealth(renewedGrant),
        )
        yield* Deferred.await(refreshStarted)
        yield* reconnectAlice(300).pipe(
          Effect.ensuring(Deferred.succeed(finishRefresh, undefined)),
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

        const rotationStarted = yield* Deferred.make<void>()
        const finishRotation = yield* Deferred.make<void>()
        pauseRefresh = (token) =>
          token !== 'member-a-refresh-300'
            ? Promise.resolve()
            : Effect.runPromise(
                Deferred.succeed(rotationStarted, undefined).pipe(
                  Effect.andThen(Deferred.await(finishRotation)),
                ),
              )
        const rotatingIds = yield* aliceCredentialIds
        clock.mockReturnValue(now + 18007_000)
        const staleRotation = Effect.runPromise(
          restoredAlice.execute(aliceTool.address, {}).pipe(Effect.result),
        )
        yield* Deferred.await(rotationStarted)
        const replacementGrant = yield* reconnectAlice(400).pipe(
          Effect.ensuring(Deferred.succeed(finishRotation, undefined)),
        )
        expect(
          Result.isFailure(yield* Effect.promise(() => staleRotation)),
        ).toBe(true)
        expect(refreshTokens.has('member-a-refresh-301')).toBe(true)
        expect(refreshTokens.has('member-a-refresh-400')).toBe(true)
        const replacementIds = yield* aliceCredentialIds
        expect(replacementIds).toHaveLength(2)
        expect(replacementIds.filter((id) => rotatingIds.includes(id))).toEqual(
          [],
        )
        expect(
          JSON.stringify(yield* restoredAlice.execute(aliceTool.address, {})),
        ).toContain('member-a-access-400')

        const anotherAlice = yield* open('member-a')
        members.push(anotherAlice)
        const loserStarted = yield* Deferred.make<void>()
        const finishLoser = yield* Deferred.make<void>()
        let attempts = 0
        pauseRefresh = (token) => {
          if (token !== 'member-a-refresh-400' || ++attempts !== 1)
            return Promise.resolve()
          return Effect.runPromise(
            Deferred.succeed(loserStarted, undefined).pipe(
              Effect.andThen(Deferred.await(finishLoser)),
            ),
          )
        }
        clock.mockReturnValue(now + 21609_000)
        const loser = Effect.runPromise(
          restoredAlice.connections.checkHealth(replacementGrant),
        )
        yield* Deferred.await(loserStarted)
        const winner = yield* anotherAlice
          .execute(aliceTool.address, {})
          .pipe(Effect.ensuring(Deferred.succeed(finishLoser, undefined)))
        expect(JSON.stringify(winner)).toContain('member-a-access-401')
        expect((yield* Effect.promise(() => loser)).status).toBe('expired')
        const afterWinner = yield* restoredAlice.connections.list({
          integration: slug,
        })
        expect(afterWinner[0]?.lastHealth?.status).not.toBe('expired')
        const winningIds = yield* aliceCredentialIds
        expect(winningIds).toHaveLength(2)
        expect(winningIds.filter((id) => replacementIds.includes(id))).toEqual(
          [],
        )

        const responseStarted = yield* Deferred.make<void>()
        const finishResponse = yield* Deferred.make<void>()
        pauseRefreshResponse = (token) =>
          token !== 'member-a-refresh-401'
            ? Promise.resolve()
            : Effect.runPromise(
                Deferred.succeed(responseStarted, undefined).pipe(
                  Effect.andThen(Deferred.await(finishResponse)),
                ),
              )
        clock.mockReturnValue(now + 25211_000)
        const delayedRotation = Effect.runPromise(
          restoredAlice.execute(aliceTool.address, {}).pipe(Effect.result),
        )
        yield* Deferred.await(responseStarted)
        expect(refreshTokens.has('member-a-refresh-402')).toBe(true)
        yield* anotherAlice.connections
          .remove(replacementGrant)
          .pipe(Effect.ensuring(Deferred.succeed(finishResponse, undefined)))
        expect(
          Result.isFailure(yield* Effect.promise(() => delayedRotation)),
        ).toBe(true)
        expect(refreshTokens.has('member-a-refresh-402')).toBe(false)
        expect(yield* aliceCredentialIds).toEqual([])
        expect(
          yield* restoredAlice.connections.list({ integration: slug }),
        ).toEqual([])

        const missingBindingGrant = yield* reconnectAlice(500)
        const retainedIds = yield* aliceCredentialIds

        const removedClient = sqlite
          .prepare(
            `delete from "${oauth_client.names.sql}" where client_id = 'garden-dev'`,
          )
          .run()
        expect(removedClient.changes).toBe(1)
        const callsBeforeMissingBinding = http.mock.calls.length
        const failedRemoval = yield* restoredAlice.connections
          .remove(missingBindingGrant)
          .pipe(Effect.result)
        expect(Result.isFailure(failedRemoval)).toBe(true)
        expect(http.mock.calls).toHaveLength(callsBeforeMissingBinding)
        expect(refreshTokens.has('member-a-refresh-500')).toBe(true)
        expect(yield* aliceCredentialIds).toEqual(retainedIds)
        expect(
          yield* restoredAlice.connections.list({ integration: slug }),
        ).toHaveLength(1)
      }),
    ).finally(async () => {
      await Effect.runPromise(
        Effect.forEach(members, (executor) => executor.close()),
      )
    })
    expect(revocationRedirects.length).toBeGreaterThan(0)
    expect(new Set(revocationRedirects)).toEqual(new Set(['manual']))
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
