import { Effect, Option } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { projectExecutorProviders } from './catalog'
import {
  IntegrationsShCatalogEntry,
  IntegrationsShDomainSurface,
  IntegrationsShSurface,
} from './integrations-sh'
import { previewProviderTools } from './tool-preview'

const openApiEntry = IntegrationsShCatalogEntry.make({
  id: 'discovered/example-com-openapi',
  kind: 'openapi',
  slug: 'example-com-openapi',
  name: 'example.com',
  description: 'Example API',
  url: Option.none(),
  spec: Option.some('https://example.com/openapi.json'),
  icon: Option.none(),
  domain: 'example.com',
  categories: ['developer_tools'],
  popularity: Option.some(1),
})

describe('Executor source tool previews', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('never substitutes MCP tools for a missing OpenAPI definition', async () => {
    const provider = projectExecutorProviders([
      IntegrationsShCatalogEntry.make({
        ...openApiEntry,
        spec: Option.none(),
      }),
    ]).find((candidate) => String(candidate.providerId) === 'example.com')
    expect(provider).toBeDefined()
    if (provider === undefined) return

    const preview = await Effect.runPromise(
      previewProviderTools(
        provider,
        IntegrationsShDomainSurface.make({
          domain: 'example.com',
          description: Option.none(),
          summary: Option.none(),
          surfaces: [
            IntegrationsShSurface.make({
              type: 'mcp',
              slug: 'example-com-mcp',
              name: 'Example MCP',
              endpoint: Option.some('https://example.com/mcp'),
              spec: Option.none(),
              transports: ['streamable-http'],
              docs: Option.none(),
            }),
          ],
        }),
        'openapi',
      ),
    )

    expect(preview.status).toBe('definition_missing')
    expect(preview.tools).toEqual([])
  })

  it('lists every OpenAPI operation before installation', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        Response.json({
          openapi: '3.1.0',
          info: { title: 'Example', version: '1' },
          paths: {
            '/widgets': {
              get: {
                operationId: 'listWidgets',
                summary: 'List widgets',
              },
              post: {
                operationId: 'createWidget',
                summary: 'Create a widget',
              },
            },
          },
        }),
      ),
    )

    const provider = projectExecutorProviders([openApiEntry]).find(
      (candidate) => String(candidate.providerId) === 'example.com',
    )
    expect(provider).toBeDefined()
    if (provider === undefined) return

    const preview = await Effect.runPromise(
      previewProviderTools(
        provider,
        IntegrationsShDomainSurface.make({
          domain: 'example.com',
          description: Option.none(),
          summary: Option.none(),
          surfaces: [],
        }),
        'openapi',
      ),
    )

    expect(preview.status).toBe('ready')
    expect(preview.tools).toEqual([
      expect.objectContaining({ name: 'listWidgets' }),
      expect.objectContaining({ name: 'createWidget' }),
    ])
    expect(Option.getOrNull(preview.toolCount)).toBe(2)
  })
})
