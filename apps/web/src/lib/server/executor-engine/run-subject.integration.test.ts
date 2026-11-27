// @vitest-environment node
import { DatabaseSync } from 'node:sqlite'
import {
  AuthTemplateSlug,
  ConnectionName,
  IntegrationSlug,
  Subject,
  Tenant,
  createExecutor,
} from '@executor-js/sdk/core'
import type { OpenApiPluginExtension } from '@executor-js/plugin-openapi/core'
import { Effect, Layer, Result } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import { expect, it, onTestFinished } from 'vitest'
import { executorSubjectFor } from '@garden/agent-runtime/src/runtime-mcp-controller'
import {
  readRunConnectorIdentity,
  resolveRunConnectorIdentity,
} from '@garden/server/issues/run-connector-identity'
import { sqliteD1 } from '@/test/executor-sqlite-d1'
import { createD1ExecutorDb } from './d1'
import { makeExecutorPlugins } from './plugins'

it('executes with organization and triggering-member credentials in separate run scopes', async () => {
  const sqlite = new DatabaseSync(':memory:')
  onTestFinished(() => sqlite.close())
  const url = 'https://provider.example.invalid'
  const used: string[] = []
  const spec = {
    openapi: '3.0.3',
    info: { title: 'Qualification', version: '1' },
    servers: [{ url }],
    components: {
      securitySchemes: {
        fixtureKey: { type: 'apiKey', in: 'header', name: 'X-Fixture' },
      },
    },
    security: [{ fixtureKey: [] }],
    paths: {
      '/who': {
        get: {
          operationId: 'who',
          responses: { '200': { description: 'OK' } },
        },
      },
    },
  }
  const http: typeof fetch = async (input, init) => {
    const request = new Request(input, init)
    if (request.url === url + '/spec') return Response.json(spec)
    if (request.url !== url + '/who') throw new Error('Unexpected fixture URL')
    const credential = request.headers.get('X-Fixture')
    if (!credential) return new Response(null, { status: 401 })
    used.push(credential)
    return Response.json({ ok: true })
  }
  const open = (tenant: string, userId: string | null) =>
    createExecutor({
      tenant: Tenant.make(tenant),
      onElicitation: () => Effect.succeed({ action: 'decline' as const }),
      subject: Subject.make(
        executorSubjectFor({ agentId: 'agent', connectorUserId: userId }),
      ),
      db: ({ tables }) => createD1ExecutorDb(sqliteD1(sqlite), tables),
      plugins: makeExecutorPlugins('synthetic encryption key', { fetch: http }),
      fetch: http,
      httpClientLayer: FetchHttpClient.layer.pipe(
        Layer.provide(Layer.succeed(FetchHttpClient.Fetch, http)),
      ),
    })
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const acquire = (tenant: string, member: string | null) =>
          Effect.acquireRelease(open(tenant, member), (executor) =>
            executor.close().pipe(Effect.orDie),
          )
        const owner = yield* acquire('workspace', 'owner')
        const requester = resolveRunConnectorIdentity({
          actor: { type: 'member', id: 'requester' },
        })
        const member = yield* acquire(
          'workspace',
          readRunConnectorIdentity({
            connectorIdentity: requester,
          }).userId,
        )
        const noMember = yield* acquire(
          'workspace',
          readRunConnectorIdentity({
            actor: { type: 'agent', id: 'agent' },
          }).userId,
        )
        const otherWorkspace = yield* acquire('other', null)
        const slug = IntegrationSlug.make('qualification')
        const openApi: OpenApiPluginExtension = owner.openapi
        yield* openApi.addSpec({
          slug,
          name: 'Qualification',
          spec: { kind: 'url', url: url + '/spec' },
        })
        const integration = yield* owner.integrations.get(slug)
        const template = integration?.authMethods.find(
          (method) => method.kind === 'apikey',
        )?.template
        if (!template) throw new Error('Missing fixture API key template')
        for (const [executor, scope, name] of [
          [owner, 'org', 'shared'],
          [owner, 'user', 'private'],
          [member, 'user', 'member'],
        ] as const) {
          yield* executor.connections.create({
            integration: slug,
            owner: scope,
            name: ConnectionName.make(name),
            template: AuthTemplateSlug.make(template),
            value: name,
          })
        }
        const orgTools = yield* noMember.tools.list({ integration: slug })
        const memberTools = yield* member.tools.list({ integration: slug })
        const ownerTools = yield* owner.tools.list({ integration: slug })
        expect(orgTools.map((tool) => tool.connection)).toEqual(['shared'])
        expect(memberTools.map((tool) => tool.connection).sort()).toEqual([
          'member',
          'shared',
        ])
        expect(yield* otherWorkspace.tools.list({ integration: slug })).toEqual(
          [],
        )
        const shared = orgTools[0]
        const personal = memberTools.find(
          (tool) => tool.connection === 'member',
        )
        const privateTool = ownerTools.find(
          (tool) => tool.connection === 'private',
        )
        if (!shared || !personal || !privateTool)
          throw new Error('Missing fixture tools')
        yield* noMember.execute(shared.address, {})
        yield* member.execute(personal.address, {})
        expect(used).toEqual(['shared', 'member'])
        for (const denied of [
          noMember.execute(personal.address, {}),
          noMember.execute(privateTool.address, {}),
          member.execute(privateTool.address, {}),
          otherWorkspace.execute(shared.address, {}),
        ]) {
          const result = yield* Effect.result(denied)
          expect(Result.isFailure(result) && result.failure._tag).toBe(
            'ToolNotFoundError',
          )
        }
        expect(used).toEqual(['shared', 'member'])
      }),
    ),
  )
})
