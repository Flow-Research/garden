// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { Effect, Layer } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import {
  AuthTemplateSlug,
  ConnectionName,
  IntegrationSlug,
  Subject,
  Tenant,
  type InvokeToolInput,
  createExecutor,
} from '@executor-js/sdk/core'
import { encryptedSecretsPlugin } from '@executor-js/plugin-encrypted-secrets'
import {
  invokeXResearch,
  parseXResearchInput,
  xAuthMethods,
  xResearchPlugin,
  type XResearchOptions,
} from './x-research'

const tenant = Tenant.make('workspace-a')
const subject = Subject.make('user-a')
const options: XResearchOptions = {
  dailyBudgetMicroUsd: '1000000',
  postPriceMicroUsd: '5000',
  userPriceMicroUsd: '10000',
  reserve: () => Effect.succeed({ kind: 'reserved', reservedMicroUsd: 310000 }),
}
/** Mock only the invocation seam; real SDK catalog ownership is tested below. */
function invocation(
  fetch: typeof globalThis.fetch,
  name = 'x_read_feed',
  args: unknown = { limit: 2 },
): InvokeToolInput<unknown> {
  return {
    ctx: {
      owner: { tenant, subject },
      httpClientLayer: FetchHttpClient.layer.pipe(
        Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch)),
      ),
      connections: { update: vi.fn(() => Effect.succeed({})) },
    },
    toolRow: {
      tenant,
      subject,
      owner: 'user',
      integration: 'x-research',
      name,
    },
    credential: {
      owner: 'user',
      integration: IntegrationSlug.make('x-research'),
      connection: ConnectionName.make('personal'),
      template: AuthTemplateSlug.make('x-read'),
      value: 'private-access-token',
      values: {},
      config: {},
      grantedScopes: ['tweet.read', 'users.read'],
    },
    args,
  } as unknown as InvokeToolInput<unknown>
}

describe('X personal research', () => {
  it('keeps bookmark scope opt-in', () => {
    expect(xAuthMethods[0].oauth?.scopes).not.toContain('bookmark.read')
    expect(xAuthMethods[1].oauth?.scopes).toContain('bookmark.read')
  })
  it.each([
    { limit: 21 },
    { limit: 2, userId: 'other-user' },
    { url: 'https://evil.example' },
    { limit: 0 },
    [],
  ])('rejects unbounded or undeclared input %j', async (args) => {
    await expect(
      Effect.runPromise(parseXResearchInput('x_read_feed', args)),
    ).rejects.toThrow('invalid')
  })
  it('rejects archive search instead of silently changing the window', async () => {
    await expect(
      Effect.runPromise(
        parseXResearchInput('x_search_posts', {
          query: 'LagosLife',
          startTime: '2020-01-01T00:00:00Z',
        }),
      ),
    ).rejects.toThrow('seven days')
  })
  it('SDK exposes personal catalog tools and no organization-owned X tools', async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const executor = yield* Effect.acquireRelease(
            createExecutor({
              tenant,
              subject,
              plugins: [
                xResearchPlugin(),
                encryptedSecretsPlugin({
                  key: 'test-secret-key-at-least-32-characters',
                }),
              ] as const,
            }),
            (executor) => executor.close().pipe(Effect.ignore),
          )
          yield* executor.xResearch.install()
          yield* executor.connections.create({
            owner: 'user',
            integration: IntegrationSlug.make('x-research'),
            name: ConnectionName.make('personal'),
            template: AuthTemplateSlug.make('x-read'),
            values: { token: 'secret' },
          })
          yield* executor.connections.create({
            owner: 'org',
            integration: IntegrationSlug.make('x-research'),
            name: ConnectionName.make('shared'),
            template: AuthTemplateSlug.make('x-read'),
            values: { token: 'secret' },
          })
          const tools = yield* executor.tools.list()
          expect(
            tools
              .filter((tool) => String(tool.integration) === 'x-research')
              .map((tool) => String(tool.name))
              .sort(),
          ).toEqual([
            'x_get_posts',
            'x_read_feed',
            'x_read_thread',
            'x_search_posts',
          ])
          expect(tools.every((tool) => tool.owner === 'user')).toBe(true)
        }),
      ),
    )
  })
  it('denies another subject, shared credentials, missing scopes and missing budget before any HTTP', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    const input = invocation(fetch)
    const cases = [
      { ...input, toolRow: { ...input.toolRow, subject: 'other' } },
      { ...input, toolRow: { ...input.toolRow, owner: 'org' } },
      { ...input, credential: { ...input.credential, grantedScopes: [] } },
    ]
    for (const value of cases)
      await expect(
        Effect.runPromise(
          invokeXResearch(options, value as InvokeToolInput<unknown>),
        ),
      ).rejects.toThrow()
    await expect(Effect.runPromise(invokeXResearch({}, input))).rejects.toThrow(
      'disabled',
    )
    expect(fetch).not.toHaveBeenCalled()
  })
  it('resolves your account, sends a single bounded page and returns provenance without credentials', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        Response.json({ data: { id: '123', username: 'owner' } }),
      )
      .mockResolvedValueOnce(
        Response.json({
          data: [
            {
              id: '456',
              text: 'LagosLife update',
              author_id: '789',
              created_at: '2026-10-10T00:00:00Z',
            },
          ],
          includes: { users: [{ id: '789', username: 'lagoslife' }] },
          meta: { next_token: 'next' },
        }),
      )
    const reserve = vi.fn(() =>
      Effect.succeed({ kind: 'reserved' as const, reservedMicroUsd: 40000 }),
    )
    const result = await Effect.runPromise(
      invokeXResearch({ ...options, reserve }, invocation(fetch)),
    )
    expect(reserve).toHaveBeenCalledWith(
      'user-a',
      40000,
      1000000,
      expect.any(String),
    )
    expect(fetch).toHaveBeenCalledTimes(2)
    const urls = fetch.mock.calls.map((call) => new URL(String(call[0])))
    expect(urls[0].pathname).toBe('/2/users/me')
    expect(urls[1].pathname).toBe(
      '/2/users/123/timelines/reverse_chronological',
    )
    expect(urls[1].searchParams.get('max_results')).toBe('2')
    expect(result).toMatchObject({
      posts: [
        {
          id: '456',
          url: 'https://x.com/i/web/status/456',
          author: { username: 'lagoslife' },
        },
      ],
      nextCursor: 'next',
      contentTrust: 'untrusted_source_text',
    })
    expect(JSON.stringify(result)).not.toContain('private-access-token')
  })
  it('makes no HTTP call when the daily budget is exhausted', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    await expect(
      Effect.runPromise(
        invokeXResearch(
          { ...options, reserve: () => Effect.succeed({ kind: 'exhausted' }) },
          invocation(fetch),
        ),
      ),
    ).rejects.toThrow('daily')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('reports rate limits without retrying or leaking the provider body', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response('private-access-token', {
        status: 429,
        headers: { 'x-rate-limit-reset': '1791633600' },
      }),
    )
    await expect(
      Effect.runPromise(invokeXResearch(options, invocation(fetch))),
    ).rejects.toThrow('HTTP 429')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('deduplicates anchor and recent replies and marks the conversation partial', async () => {
    const anchor = { id: '456', text: 'anchor', conversation_id: '456' }
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        Response.json({ data: { id: '123', username: 'owner' } }),
      )
      .mockResolvedValueOnce(Response.json({ data: [anchor] }))
      .mockResolvedValueOnce(
        Response.json({
          data: [
            anchor,
            {
              id: '457',
              text: 'reply',
              conversation_id: '456',
              referenced_posts: [{ type: 'replied_to', id: '456' }],
            },
          ],
          meta: { next_token: 'next' },
        }),
      )
    const result = await Effect.runPromise(
      invokeXResearch(
        options,
        invocation(fetch, 'x_read_thread', { postId: '456', limit: 11 }),
      ),
    )
    expect(fetch).toHaveBeenCalledTimes(3)
    const query = new URL(String(fetch.mock.calls[2][0]))
    expect(query.searchParams.get('max_results')).toBe('10')
    expect(query.searchParams.get('query')).toBe('conversation_id:456')
    expect(result).toMatchObject({
      kind: 'partial',
      posts: [
        { id: '456' },
        { id: '457', references: [{ id: '456', type: 'replied_to' }] },
      ],
      coverage: {
        window: 'recent_seven_days_only',
        complete: false,
        hasMore: true,
      },
    })
  })
  it('rejects bookmark reads with a research-only grant before HTTP', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    await expect(
      Effect.runPromise(
        invokeXResearch(options, invocation(fetch, 'x_read_bookmarks')),
      ),
    ).rejects.toThrow('required read scopes')
    expect(fetch).not.toHaveBeenCalled()
  })
})
