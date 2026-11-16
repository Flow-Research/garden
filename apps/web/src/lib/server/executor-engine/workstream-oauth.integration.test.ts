// @vitest-environment node
import { createHash } from 'node:crypto'
import { Effect, Result } from 'effect'
import {
  AuthTemplateSlug,
  ConnectionName,
  IntegrationSlug,
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
import { ensureServerManagedOAuthClient } from './auth-contract'

const resource = 'https://workstream.flowresearch.tech/mcp'
const issuer = 'https://identity.flowresearch.tech/realms/flow'
const tokenUrl = `${issuer}/protocol/openid-connect/token`
const callback =
  'https://garden-staging.flow-research.workers.dev/api/oauth/callback'
const scopes = ['workstream:access', 'workstream-mcp-audience']
const slug = IntegrationSlug.make('workstream')

/** Exercises the installed OAuth/MCP engine and encrypted provider over a shared
 * in-memory FumaDB store. Only provider HTTP is replaced; no live credentials or services. */
describe('Workstream public OAuth lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('binds PKCE callbacks and refresh credentials to each member', async () => {
    const codes = new Map<string, { member: string; challenge: string }>()
    const refreshes: string[] = []
    const tokenRequests: URLSearchParams[] = []
    const challenges = new Map<string, string>()
    const tokenAuthorizations: (string | null)[] = []
    const http = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init)
      if (request.url.includes('/.well-known/oauth-protected-resource')) {
        return Response.json({
          resource,
          authorization_servers: [issuer],
          scopes_supported: scopes,
        })
      }
      if (request.url.includes('/.well-known/')) {
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
          token_endpoint: tokenUrl,
          response_types_supported: ['code'],
          scopes_supported: scopes,
          code_challenge_methods_supported: ['S256'],
        })
      }
      if (request.url === tokenUrl) {
        const body = new URLSearchParams(await request.text())
        tokenRequests.push(body)
        tokenAuthorizations.push(request.headers.get('authorization'))
        let member: string
        if (body.get('grant_type') === 'authorization_code') {
          const code = codes.get(body.get('code') ?? '')
          if (code === undefined)
            return Response.json({ error: 'invalid_grant' }, { status: 400 })
          member = code.member
          codes.delete(body.get('code') ?? '')
        } else {
          if (body.get('grant_type') !== 'refresh_token')
            return Response.json(
              { error: 'unsupported_grant_type' },
              { status: 400 },
            )
          member = (body.get('refresh_token') ?? '').replace('-refresh', '')
          if (!['member-a', 'member-b'].includes(member))
            return Response.json({ error: 'invalid_grant' }, { status: 400 })
          refreshes.push(member)
        }
        return Response.json({
          access_token: `${member}-access`,
          refresh_token: `${member}-refresh`,
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'workstream:access',
        })
      }
      if (request.url === resource) {
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
    const plugins = [
      mcpPlugin({ fetch: http }),
      encryptedSecretsPlugin({ key: 'workstream-oauth-test-encryption-key' }),
    ] as const
    const open = (member: string) =>
      createExecutor({
        tenant: Tenant.make('workspace-a'),
        subject: Subject.make(member),
        db,
        plugins,
        fetch: http,
        redirectUri: callback,
        onElicitation: 'accept-all',
      })
    const members = await Effect.runPromise(
      Effect.all([open('member-a'), open('member-b')]),
    )
    const [alice, bob] = members
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* alice.mcp.addServer({
          slug: 'workstream',
          name: 'Workstream',
          endpoint: resource,
          authenticationTemplate: [{ slug: 'oauth2', kind: 'oauth2' }],
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
            WORKSTREAM_MCP_CLIENT_ID: 'garden-staging',
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
          const connection = yield* executor.oauth.complete({
            state: flow.state,
            code: member,
          })
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
        vi.spyOn(Date, 'now').mockReturnValue(now + 3601_000)
        expect(
          JSON.stringify(yield* alice.execute(aliceTool.address, {})),
        ).toContain('member-a-access')
        expect(refreshes).toEqual(['member-a'])
        expect(
          JSON.stringify(yield* restoredBob.execute(bobTool.address, {})),
        ).toContain('member-b-access')
        expect(refreshes).toEqual(['member-a', 'member-b'])
        expect(tokenRequests).toHaveLength(4)
        expect(tokenAuthorizations).toEqual([null, null, null, null])
        for (const body of tokenRequests) {
          expect(body.get('client_id')).toBe('garden-staging')
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
          'workstream:access',
          'workstream:access',
        ])
        const ref = (yield* alice.connections.list({ integration: slug }))[0]
        expect(ref).toBeDefined()
        if (ref === undefined) return
        yield* alice.connections.remove(ref)
        expect(yield* alice.connections.list({ integration: slug })).toEqual([])
        expect(yield* bob.connections.list({ integration: slug })).toHaveLength(
          1,
        )
        expect(
          JSON.stringify(yield* restoredBob.execute(bobTool.address, {})),
        ).toContain('member-b-access')
        expect(refreshes).toEqual(['member-a', 'member-b'])
      }),
    ).finally(async () => {
      await Effect.runPromise(
        Effect.forEach(members, (executor) => executor.close()),
      )
    })
  })
})
