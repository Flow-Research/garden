import { describe, expect, it } from 'vitest'
import { Effect, Option } from 'effect'
import {
  IntegrationSlug,
  OAuthClientSlug,
  type AuthMethodDescriptor,
  type CreateOAuthClientInput,
  type Integration,
  type OAuthClientSummary,
} from '@executor-js/sdk/core'
import {
  ensureServerManagedOAuthClient,
  modelExecutorAuthMethods,
  oauthClientSupportsMethod,
} from './auth-contract'

const googleMethod: AuthMethodDescriptor = {
  id: 'googleOAuth2',
  label: 'Google OAuth',
  kind: 'oauth',
  template: 'googleOAuth2',
  oauth: {
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['openid', 'https://www.googleapis.com/auth/gmail.readonly'],
  },
}

const googleIntegration: Integration = {
  slug: IntegrationSlug.make('google_gmail'),
  name: 'Gmail',
  description: 'Google Gmail API',
  kind: 'openapi',
  canRemove: true,
  canRefresh: true,
  authMethods: [googleMethod],
  family: 'google',
}

describe('Executor auth contract', () => {
  it('models OAuth as provider-managed without a client-registration mode', () => {
    const [method] = modelExecutorAuthMethods(googleIntegration)

    expect(method).toMatchObject({
      kind: 'oauth',
      id: 'googleOAuth2',
      scopes: googleMethod.oauth?.scopes,
    })
    expect(method).not.toHaveProperty('setup')
  })

  it('creates one workspace-owned Google OAuth client from server env', async () => {
    const created: CreateOAuthClientInput[] = []
    const clients: readonly OAuthClientSummary[] = []
    const registry: Parameters<typeof ensureServerManagedOAuthClient>[0] = {
      listClients: () => Effect.succeed(clients),
      createClient: (input: CreateOAuthClientInput) => {
        created.push(input)
        return Effect.succeed(input.slug)
      },
    }

    const managed = await Effect.runPromise(
      ensureServerManagedOAuthClient(
        registry,
        googleIntegration,
        googleMethod,
        {
          GOOGLE_CLIENT_ID: 'google-client',
          GOOGLE_CLIENT_SECRET: 'google-secret',
        },
      ),
    )

    expect(Option.getOrNull(managed)).toMatchObject({ owner: 'org' })
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({
      owner: 'org',
      clientId: 'google-client',
      clientSecret: 'google-secret',
      authorizationUrl: googleMethod.oauth?.authorizationUrl,
      tokenUrl: googleMethod.oauth?.tokenUrl,
    })
  })

  it('fails closed when deployment-owned Google credentials are absent', async () => {
    let creates = 0
    const clients: readonly OAuthClientSummary[] = []
    const registry: Parameters<typeof ensureServerManagedOAuthClient>[0] = {
      listClients: () => Effect.succeed(clients),
      createClient: (input: CreateOAuthClientInput) => {
        creates += 1
        return Effect.succeed(input.slug)
      },
    }

    const managed = await Effect.runPromise(
      ensureServerManagedOAuthClient(
        registry,
        googleIntegration,
        googleMethod,
        {},
      ),
    )

    expect(Option.isNone(managed)).toBe(true)
    expect(creates).toBe(0)
  })

  it('reuses one Google app across curated APIs with identical endpoints', () => {
    const client: OAuthClientSummary = {
      owner: 'org',
      slug: OAuthClientSlug.make('garden-google'),
      grant: 'authorization_code',
      authorizationUrl: googleMethod.oauth?.authorizationUrl ?? '',
      tokenUrl: googleMethod.oauth?.tokenUrl ?? '',
      clientId: 'google-client',
      origin: {
        kind: 'manual',
        integration: IntegrationSlug.make('google_drive'),
      },
    }

    expect(
      oauthClientSupportsMethod(client, googleIntegration, googleMethod, {}),
    ).toBe(true)
  })
})

const workstreamMethod: AuthMethodDescriptor = {
  id: 'oauth2',
  label: 'OAuth',
  kind: 'oauth',
  template: 'oauth2',
  oauth: {
    discoveryUrl: 'https://workstream.flowresearch.tech/mcp',
    supportsDynamicRegistration: true,
  },
}
const workstreamIntegration: Integration = {
  slug: IntegrationSlug.make('workstream'),
  name: 'Workstream',
  description: 'Governed work',
  kind: 'mcp',
  canRemove: true,
  canRefresh: true,
  authMethods: [workstreamMethod],
}
const workstreamEnv = { WORKSTREAM_MCP_CLIENT_ID: 'garden-staging' }
const workstreamClient: OAuthClientSummary = {
  owner: 'org',
  slug: OAuthClientSlug.make('garden-workstream'),
  grant: 'authorization_code',
  clientId: 'garden-staging',
  authorizationUrl:
    'https://identity.flowresearch.tech/realms/flow/protocol/openid-connect/auth',
  tokenUrl:
    'https://identity.flowresearch.tech/realms/flow/protocol/openid-connect/token',
  resource: 'https://workstream.flowresearch.tech/mcp',
  origin: { kind: 'manual', integration: workstreamIntegration.slug },
}

const workstreamRegistry = (clients: readonly OAuthClientSummary[] = []) => {
  const created: CreateOAuthClientInput[] = []
  return {
    created,
    registry: {
      listClients: () => Effect.succeed(clients),
      createClient: (input: CreateOAuthClientInput) => {
        created.push(input)
        return Effect.succeed(input.slug)
      },
    },
  }
}

describe('Workstream deployment-owned public OAuth app', () => {
  it('registers a resource-bound public client for the discovery-only MCP method', async () => {
    const { registry, created } = workstreamRegistry()
    const managed = await Effect.runPromise(
      ensureServerManagedOAuthClient(
        registry,
        workstreamIntegration,
        workstreamMethod,
        workstreamEnv,
      ),
    )

    expect(Option.getOrNull(managed)).toEqual({
      owner: 'org',
      slug: workstreamClient.slug,
    })
    expect(created).toEqual([{ ...workstreamClient, clientSecret: '' }])
  })

  it('reuses the exact deployment app without sharing a member credential', async () => {
    const { registry, created } = workstreamRegistry([workstreamClient])
    const managed = await Effect.runPromise(
      ensureServerManagedOAuthClient(
        registry,
        workstreamIntegration,
        workstreamMethod,
        workstreamEnv,
      ),
    )

    expect(Option.getOrNull(managed)?.slug).toBe(workstreamClient.slug)
    expect(created).toEqual([])
  })

  it('requires deployment configuration even with stored app metadata', async () => {
    const { registry, created } = workstreamRegistry([workstreamClient])
    const managed = await Effect.runPromise(
      ensureServerManagedOAuthClient(
        registry,
        workstreamIntegration,
        workstreamMethod,
        {},
      ),
    )

    expect(Option.isNone(managed)).toBe(true)
    expect(created).toEqual([])
  })

  it.each([
    { resource: 'https://workstream.flowresearch.tech/api' },
    { resource: null },
    { tokenUrl: 'https://attacker.example/token' },
    {
      authorizationUrl: 'https://identity.flowresearch.tech/realms/other/auth',
    },
    { clientId: 'garden-dev' },
    { owner: 'user' as const },
    { grant: 'client_credentials' as const },
  ])('rejects a mismatched app despite matching origin: %j', (changed) => {
    expect(
      oauthClientSupportsMethod(
        { ...workstreamClient, ...changed },
        workstreamIntegration,
        workstreamMethod,
        workstreamEnv,
      ),
    ).toBe(false)
  })

  it.each([
    'https://workstream.flowresearch.tech/mcp/other',
    'https://attacker.example/mcp',
    'https://workstream.flowresearch.tech.evil.example/mcp',
  ])(
    'never attaches the deployment app to another target: %s',
    async (discoveryUrl) => {
      const foreignMethod = {
        ...workstreamMethod,
        oauth: { discoveryUrl, supportsDynamicRegistration: true },
      }
      const { registry, created } = workstreamRegistry([workstreamClient])
      expect(
        oauthClientSupportsMethod(
          workstreamClient,
          workstreamIntegration,
          foreignMethod,
          workstreamEnv,
        ),
      ).toBe(false)
      const managed = await Effect.runPromise(
        ensureServerManagedOAuthClient(
          registry,
          workstreamIntegration,
          foreignMethod,
          workstreamEnv,
        ),
      )
      expect(Option.isNone(managed)).toBe(true)
      expect(created).toEqual([])
    },
  )
})
