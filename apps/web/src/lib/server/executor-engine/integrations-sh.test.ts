import { Effect, Layer } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import { describe, expect, it, vi } from 'vitest'
import { createIntegrationsShExtension } from './integrations-sh'

describe('integrations.sh catalog transport', () => {
  it('decodes and caches every discovery candidate without applying policy', async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        generatedAt: '2026-07-19T00:00:00.000Z',
        data: [
          {
            id: 'mcp/resend',
            kind: 'mcp',
            slug: 'resend',
            name: 'Resend',
            description: 'Email',
            url: 'https://mcp.resend.com/mcp',
            icon: null,
            domain: 'resend.com',
            categories: ['email'],
            popularity: 10,
          },
          {
            id: 'openapi/resend',
            kind: 'openapi',
            slug: 'resend-openapi',
            name: 'Resend',
            description: 'Email API',
            icon: null,
            domain: 'resend.com',
            categories: ['email'],
            popularity: 9,
          },
          {
            id: 'cli/resend',
            kind: 'cli',
            slug: 'resend-cli',
            name: 'Resend CLI',
            description: 'CLI',
            icon: null,
            domain: 'resend.com',
            categories: ['email'],
            popularity: 8,
          },
        ],
      }),
    )
    const extension = createIntegrationsShExtension()
    const httpLayer = FetchHttpClient.layer.pipe(
      Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch)),
    )

    const [first, second] = await Effect.runPromise(
      Effect.all([extension.catalog(), extension.catalog()]).pipe(
        Effect.provide(httpLayer),
      ),
    )

    expect(first.data.map((entry) => entry.kind)).toEqual([
      'mcp',
      'openapi',
      'cli',
    ])
    expect(second).toEqual(first)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
