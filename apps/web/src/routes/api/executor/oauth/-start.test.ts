import { Effect, Result } from 'effect'
import { IntegrationSlug, type Integration } from '@executor-js/sdk/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { bindAppEnv, type AppEnv } from '@/lib/server/env'
import { connectionOwnershipLayer } from '@/lib/server/executor-engine/connection-ownership'
import { beginOAuth } from './start'

const mocks = vi.hoisted(() => ({
  identities: [] as unknown[],
  executor: {
    integrations: { get: vi.fn() },
    oauth: {
      listClients: vi.fn(),
      createClient: vi.fn(),
      probe: vi.fn(),
      registerDynamicClient: vi.fn(),
      start: vi.fn(),
    },
  },
}))

// Replace only Executor acquisition; exercise the production route and policies.
vi.mock('@/lib/server/executor-runtime', () => ({
  executorProgram: (
    identity: unknown,
    run: (executor: typeof mocks.executor) => unknown,
  ) => {
    mocks.identities.push(identity)
    return run(mocks.executor)
  },
}))

const integration: Integration = {
  slug: IntegrationSlug.make('workstream'),
  name: 'Workstream',
  description: 'Governed work',
  kind: 'mcp',
  canRemove: true,
  canRefresh: true,
  authMethods: [
    {
      id: 'oauth2',
      label: 'OAuth',
      kind: 'oauth',
      template: 'oauth2',
      oauth: {
        discoveryUrl: 'https://workstream.flowresearch.tech/mcp',
        supportsDynamicRegistration: true,
      },
    },
  ],
}

const start = (owner: 'user' | 'org', subject = 'member-a') =>
  Effect.runPromise(
    beginOAuth(
      new Request(
        'https://garden-staging.flow-research.workers.dev/api/executor/oauth/start?integration=workstream',
      ),
      { tenant: 'workspace-a', subject },
    ).pipe(Effect.provide(connectionOwnershipLayer(owner)), Effect.result),
  )

beforeEach(() => {
  vi.clearAllMocks()
  mocks.identities.length = 0
  bindAppEnv({ WORKSTREAM_MCP_CLIENT_ID: 'garden-staging' } as AppEnv)
  mocks.executor.integrations.get.mockReturnValue(Effect.succeed(integration))
  mocks.executor.oauth.listClients.mockReturnValue(Effect.succeed([]))
  mocks.executor.oauth.createClient.mockImplementation((input) =>
    Effect.succeed(input.slug),
  )
  mocks.executor.oauth.start.mockReturnValue(
    Effect.succeed({
      status: 'redirect',
      authorizationUrl:
        'https://identity.flowresearch.tech/realms/flow/protocol/openid-connect/auth',
    }),
  )
})

describe('Workstream OAuth start boundary', () => {
  it('refuses Workspace credentials before client reads, writes, or authorization', async () => {
    const outcome = await start('org')
    expect(outcome).toMatchObject({
      _tag: 'Failure',
      failure: { status: 403, message: expect.stringContaining('Personal') },
    })
    expect(mocks.executor.oauth.listClients).not.toHaveBeenCalled()
    expect(mocks.executor.oauth.createClient).not.toHaveBeenCalled()
    expect(mocks.executor.oauth.start).not.toHaveBeenCalled()
    expect(mocks.executor.oauth.probe).not.toHaveBeenCalled()
    expect(mocks.executor.oauth.registerDynamicClient).not.toHaveBeenCalled()
  })

  it('starts Personal connections with the member identity and exact callback', async () => {
    for (const subject of ['member-a', 'member-b']) {
      const outcome = await start('user', subject)
      expect(Result.isSuccess(outcome)).toBe(true)
    }
    expect(mocks.identities).toEqual([
      { tenant: 'workspace-a', subject: 'member-a' },
      { tenant: 'workspace-a', subject: 'member-b' },
    ])
    expect(mocks.executor.oauth.start).toHaveBeenCalledTimes(2)
    expect(mocks.executor.oauth.start).toHaveBeenCalledWith({
      client: 'garden-workstream',
      clientOwner: 'org',
      owner: 'user',
      name: 'Workstream',
      integration: 'workstream',
      template: 'oauth2',
      redirectUri:
        'https://garden-staging.flow-research.workers.dev/api/oauth/callback',
    })
    expect(mocks.executor.oauth.registerDynamicClient).not.toHaveBeenCalled()
  })

  it('fails closed without deployment configuration and never attempts DCR', async () => {
    bindAppEnv({} as AppEnv)
    const outcome = await start('user')
    expect(outcome).toMatchObject({
      _tag: 'Failure',
      failure: {
        status: 503,
        message: 'OAuth is not configured for this integration.',
      },
    })
    expect(mocks.executor.oauth.createClient).not.toHaveBeenCalled()
    expect(mocks.executor.oauth.start).not.toHaveBeenCalled()
    expect(mocks.executor.oauth.probe).not.toHaveBeenCalled()
    expect(mocks.executor.oauth.registerDynamicClient).not.toHaveBeenCalled()
  })

  it('preserves other integrations Workspace authorization behavior', async () => {
    mocks.executor.integrations.get.mockReturnValue(
      Effect.succeed({
        ...integration,
        slug: IntegrationSlug.make('other'),
        authMethods: [
          {
            ...integration.authMethods[0],
            oauth: {
              authorizationUrl: 'https://provider.example/authorize',
              tokenUrl: 'https://provider.example/token',
            },
          },
        ],
      }),
    )
    mocks.executor.oauth.listClients.mockReturnValue(
      Effect.succeed([
        {
          owner: 'org',
          slug: 'other-client',
          grant: 'authorization_code',
          clientId: 'other',
          authorizationUrl: 'https://provider.example/authorize',
          tokenUrl: 'https://provider.example/token',
          origin: { kind: 'manual', integration: 'other' },
        },
      ]),
    )
    const outcome = await start('org')
    expect(Result.isSuccess(outcome)).toBe(true)
    expect(mocks.executor.oauth.start).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'org', client: 'other-client' }),
    )
  })
})
