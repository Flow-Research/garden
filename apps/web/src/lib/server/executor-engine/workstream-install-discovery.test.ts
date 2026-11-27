// @vitest-environment node
import { Effect, Layer, Option } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import { createExecutor, IntegrationSlug, Tenant } from '@executor-js/sdk/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { listServerOwnedExecutorProviders } from './catalog'
import { installProvider } from './install'
import { IntegrationsShDomainSurface } from './integrations-sh'
import { makeExecutorPlugins } from './plugins'

const resource = 'https://workstream.flowresearch.tech/mcp'
const issuer = 'https://identity.flowresearch.tech/realms/flow'
const resourceMetadata =
  'https://workstream.flowresearch.tech/.well-known/oauth-protected-resource/mcp'
const surface = IntegrationsShDomainSurface.make({
  domain: 'workstream.flowresearch.tech',
  description: Option.none(),
  summary: Option.none(),
  surfaces: [],
})

afterEach(() => vi.unstubAllGlobals())

describe('Workstream installation discovery failures', () => {
  it.each([404, 503])(
    'refuses manual token setup and persists nothing when issuer metadata returns %s',
    async (status) => {
      const provider = listServerOwnedExecutorProviders().find(
        (candidate) => String(candidate.installSlug) === 'workstream',
      )
      expect(provider).toBeDefined()
      if (provider === undefined) return
      const http = vi.fn<typeof fetch>(async (input, init) => {
        const request = new Request(input, init)
        if (request.url === resource) {
          return Response.json(
            { error: 'unauthorized' },
            {
              status: 401,
              headers: {
                'www-authenticate': `Bearer resource_metadata="${resourceMetadata}"`,
              },
            },
          )
        }
        if (request.url === resourceMetadata) {
          return Response.json({ resource, authorization_servers: [issuer] })
        }
        return new Response(null, { status })
      })
      vi.stubGlobal('fetch', http)
      await Effect.runPromise(
        Effect.acquireUseRelease(
          createExecutor({
            tenant: Tenant.make('discovery-failure'),
            plugins: makeExecutorPlugins('discovery-test-key', { fetch: http }),
            fetch: http,
            httpClientLayer: FetchHttpClient.layer.pipe(
              Layer.provide(Layer.succeed(FetchHttpClient.Fetch, http)),
            ),
            onElicitation: 'accept-all',
          }),
          (executor) =>
            Effect.gen(function* () {
              const outcome = yield* Effect.result(
                installProvider(executor, provider, surface, 'mcp'),
              )
              expect(outcome).toMatchObject({
                _tag: 'Failure',
                failure: {
                  reasons: [
                    expect.stringContaining('Workstream OAuth discovery'),
                  ],
                },
              })
              expect(
                yield* executor.integrations.get(
                  IntegrationSlug.make('workstream'),
                ),
              ).toBeNull()
              expect(
                yield* executor.connections.list({
                  integration: IntegrationSlug.make('workstream'),
                }),
              ).toEqual([])
              expect(yield* executor.oauth.listClients()).toEqual([])
            }),
          (executor) => executor.close(),
        ),
      )
    },
  )
})

describe('installed SDK authorization-server discovery conventions', () => {
  it.each([
    {
      issuer: 'https://issuer.example',
      metadataUrl: 'https://issuer.example/.well-known/openid-configuration',
    },
    {
      issuer: 'https://issuer.example/tenant',
      metadataUrl:
        'https://issuer.example/.well-known/oauth-authorization-server/tenant',
    },
    {
      issuer: 'https://issuer.example/tenant/',
      metadataUrl:
        'https://issuer.example/tenant/.well-known/openid-configuration',
    },
  ])('discovers $metadataUrl', async (configuration) => {
    const requested: string[] = []
    const http = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init)
      requested.push(request.url)
      if (request.url === resourceMetadata) {
        return Response.json({
          resource,
          authorization_servers: [configuration.issuer],
        })
      }
      if (request.url === configuration.metadataUrl) {
        return Response.json({
          issuer: configuration.issuer,
          authorization_endpoint: 'https://issuer.example/authorize',
          token_endpoint: 'https://issuer.example/token',
        })
      }
      return new Response(null, { status: 404 })
    })
    const metadata = await Effect.runPromise(
      Effect.acquireUseRelease(
        createExecutor({
          tenant: Tenant.make('discovery-control'),
          httpClientLayer: FetchHttpClient.layer.pipe(
            Layer.provide(Layer.succeed(FetchHttpClient.Fetch, http)),
          ),
          onElicitation: 'accept-all',
        }),
        (executor) => executor.oauth.probe({ url: resource }),
        (executor) => executor.close(),
      ),
    )
    expect(metadata).toMatchObject({
      issuer: configuration.issuer,
      authorizationUrl: 'https://issuer.example/authorize',
      tokenUrl: 'https://issuer.example/token',
      resource,
    })
    expect(requested).toContain(configuration.metadataUrl)
  })
})
