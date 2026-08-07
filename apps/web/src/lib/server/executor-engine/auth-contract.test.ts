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
      oauthClientSupportsMethod(client, googleIntegration, googleMethod),
    ).toBe(true)
  })
})
