import { Array as EffectArray, Effect, Option, Schema } from 'effect'
import {
  OAuthClientSlug,
  type AuthMethodDescriptor,
  type CreateOAuthClientInput,
  type Integration,
  type OAuthClientSummary,
  type StorageFailure,
} from '@executor-js/sdk/core'
import {
  ExecutorAuthMethodNone,
  ExecutorAuthMethodOAuth,
  ExecutorAuthMethodSecret,
  ExecutorHttpsUrl,
  type ExecutorAuthMethod,
  type ExecutorAuthPlacement,
  type ExecutorHttpsUrl as ExecutorHttpsUrlType,
} from '@/lib/executor-contract'

const GOOGLE_AUTHORIZATION_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_CLIENT_SLUG = OAuthClientSlug.make('garden-google')

const modelPlacement = (
  placement: NonNullable<AuthMethodDescriptor['placements']>[number],
): Option.Option<ExecutorAuthPlacement> => {
  if (placement.literal !== undefined) return Option.none()
  return Option.some({
    carrier: placement.carrier,
    name: placement.name,
    prefix: placement.prefix,
    variable: placement.variable ?? 'token',
  })
}

const decodeHttpsUrl = Schema.decodeUnknownOption(ExecutorHttpsUrl)

const optionalHttpsUrl = (
  value: string | null | undefined,
): Option.Option<ExecutorHttpsUrlType> => decodeHttpsUrl(value)

/** Converts Executor's plugin-owned descriptor once at the server boundary.
 * OAuth client ownership is deliberately absent: Garden always supplies or
 * dynamically registers the provider app and never asks end users for one. */
const modelExecutorAuthMethod = (
  method: AuthMethodDescriptor,
): ExecutorAuthMethod => {
  if (method.kind === 'none') {
    return ExecutorAuthMethodNone.make({
      kind: 'none',
      id: method.id,
      label: method.label,
      template: method.template,
    })
  }

  if (method.kind === 'oauth') {
    const oauth = method.oauth
    return ExecutorAuthMethodOAuth.make({
      kind: 'oauth',
      id: method.id,
      label: method.label,
      template: method.template,
      authorizationUrl: optionalHttpsUrl(oauth?.authorizationUrl),
      tokenUrl: optionalHttpsUrl(oauth?.tokenUrl),
      resource: optionalHttpsUrl(oauth?.resource),
      scopes: [...(oauth?.scopes ?? [])],
    })
  }

  return ExecutorAuthMethodSecret.make({
    kind: 'secret',
    id: method.id,
    label: method.label,
    template: method.template,
    placements: EffectArray.getSomes(
      (method.placements ?? []).map(modelPlacement),
    ),
  })
}

/** Matches an integration-independent OAuth app by explicit origin first, then
 * by exact provider endpoints and resource. Tokens remain connection-specific. */
export const oauthClientSupportsMethod = (
  client: OAuthClientSummary,
  integration: Integration,
  method: AuthMethodDescriptor,
): boolean => {
  if (client.grant !== 'authorization_code') return false
  if (client.origin.integration === integration.slug) return true
  if (method.kind !== 'oauth' || method.oauth === undefined) return false
  const authorizationUrl = method.oauth.authorizationUrl
  const tokenUrl = method.oauth.tokenUrl
  if (authorizationUrl === undefined || tokenUrl === undefined) return false
  if (
    client.authorizationUrl !== authorizationUrl ||
    client.tokenUrl !== tokenUrl
  ) {
    return false
  }
  return (client.resource ?? null) === (method.oauth.resource ?? null)
}

interface GoogleOAuthEnv {
  readonly GOOGLE_CLIENT_ID?: string
  readonly GOOGLE_CLIENT_SECRET?: string
}

const googleClientCredentials = (
  env: GoogleOAuthEnv,
  method: AuthMethodDescriptor,
): Option.Option<{
  readonly clientId: string
  readonly clientSecret: string
}> => {
  if (
    method.kind !== 'oauth' ||
    method.oauth?.authorizationUrl !== GOOGLE_AUTHORIZATION_URL ||
    method.oauth.tokenUrl !== GOOGLE_TOKEN_URL
  ) {
    return Option.none()
  }
  const clientId = env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) return Option.none()
  return Option.some({ clientId, clientSecret })
}

export interface ServerManagedOAuthClient {
  readonly slug: OAuthClientSlug
  readonly owner: 'org'
}

interface OAuthClientRegistry {
  readonly createClient: (
    input: CreateOAuthClientInput,
  ) => Effect.Effect<OAuthClientSlug, StorageFailure>
  readonly listClients: () => Effect.Effect<
    readonly OAuthClientSummary[],
    StorageFailure
  >
}

/** Ensures plugin-declared Google OAuth uses Garden's deployment-owned app.
 * One workspace OAuth client can serve every curated Google API because scopes
 * belong to each integration method, not to the registered client record. */
export const ensureServerManagedOAuthClient = Effect.fn(
  'ExecutorAuth.ensureServerManagedOAuthClient',
)(function* (
  oauthClients: OAuthClientRegistry,
  integration: Integration,
  method: AuthMethodDescriptor,
  env: GoogleOAuthEnv,
) {
  const clients = yield* oauthClients.listClients()
  const existing = clients.find(
    (client) =>
      client.owner === 'org' &&
      oauthClientSupportsMethod(client, integration, method),
  )
  if (existing !== undefined) {
    return Option.some<ServerManagedOAuthClient>({
      slug: existing.slug,
      owner: 'org',
    })
  }

  const credentials = googleClientCredentials(env, method)
  if (Option.isNone(credentials)) {
    return Option.none<ServerManagedOAuthClient>()
  }
  const oauth = method.oauth
  if (
    method.kind !== 'oauth' ||
    oauth?.authorizationUrl === undefined ||
    oauth.tokenUrl === undefined
  ) {
    return Option.none<ServerManagedOAuthClient>()
  }

  const slug = yield* oauthClients.createClient({
    owner: 'org',
    slug: GOOGLE_CLIENT_SLUG,
    authorizationUrl: oauth.authorizationUrl,
    tokenUrl: oauth.tokenUrl,
    grant: 'authorization_code',
    clientId: credentials.value.clientId,
    clientSecret: credentials.value.clientSecret,
    resource: oauth.resource ?? null,
    origin: { kind: 'manual', integration: integration.slug },
  })
  return Option.some<ServerManagedOAuthClient>({ slug, owner: 'org' })
})

/** Models plugin-owned authentication without probing or credential fallback.
 * Provider readiness is enforced when OAuth starts, where server configuration
 * and dynamic-registration failures can retain their full Effect Cause. */
export const modelExecutorAuthMethods = (
  integration: Integration,
): readonly ExecutorAuthMethod[] =>
  integration.authMethods.map(modelExecutorAuthMethod)
