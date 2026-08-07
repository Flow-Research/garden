import { Schema } from 'effect'

const NonBlankString = Schema.Trim.check(Schema.isMinLength(1))
const HttpsString = NonBlankString.check(Schema.isPattern(/^https:\/\//))

export const ExecutorProviderId = Schema.brand('@garden/ExecutorProviderId')(
  NonBlankString,
)
export type ExecutorProviderId = typeof ExecutorProviderId.Type

export const ExecutorProviderDomain = Schema.brand(
  '@garden/ExecutorProviderDomain',
)(NonBlankString.check(Schema.isPattern(/^[a-z0-9.-]+$/)))
export type ExecutorProviderDomain = typeof ExecutorProviderDomain.Type

export const ExecutorIntegrationSlug = Schema.brand(
  '@garden/ExecutorIntegrationSlug',
)(NonBlankString)
export type ExecutorIntegrationSlug = typeof ExecutorIntegrationSlug.Type

export const ExecutorHttpsUrl = Schema.brand('@garden/ExecutorHttpsUrl')(
  HttpsString,
)
export type ExecutorHttpsUrl = typeof ExecutorHttpsUrl.Type

export const ExecutorConnectionOwner = Schema.Literals(['user', 'org'])
export type ExecutorConnectionOwner = typeof ExecutorConnectionOwner.Type

export const ExecutorConnectionAddress = Schema.brand(
  '@garden/ExecutorConnectionAddress',
)(NonBlankString)
export type ExecutorConnectionAddress = typeof ExecutorConnectionAddress.Type

export const ExecutorToolAddress = Schema.brand('@garden/ExecutorToolAddress')(
  NonBlankString,
)
export type ExecutorToolAddress = typeof ExecutorToolAddress.Type

const OptionalString = Schema.OptionFromOptionalKey(Schema.String)
const OptionalHttpsUrl = Schema.OptionFromOptionalKey(ExecutorHttpsUrl)

/** Public provider metadata. Install candidates and endpoints remain server-only. */
export const ExecutorIntegrationSource = Schema.Literals([
  'native',
  'mcp',
  'openapi',
  'graphql',
])
export type ExecutorIntegrationSource = typeof ExecutorIntegrationSource.Type

export const ExecutorRegistryEntry = Schema.Struct({
  providerId: ExecutorProviderId,
  name: NonBlankString,
  description: Schema.String,
  icon: OptionalHttpsUrl,
  domain: ExecutorProviderDomain,
  categories: Schema.Array(Schema.String),
  sources: Schema.NonEmptyArray(ExecutorIntegrationSource),
})
export type ExecutorRegistryEntry = typeof ExecutorRegistryEntry.Type

export const ExecutorRegistrySearchResponse = Schema.Struct({
  entries: Schema.Array(ExecutorRegistryEntry),
  total: Schema.Number,
  catalogSize: Schema.OptionFromOptionalKey(Schema.Number),
  fetchedAt: Schema.String,
  nextOffset: Schema.OptionFromOptionalKey(Schema.Number),
})
export type ExecutorRegistrySearchResponse =
  typeof ExecutorRegistrySearchResponse.Type

/** The client selects a provider. Server-owned catalog policy resolves every
 * protocol candidate, endpoint, specification, and integration slug. */
export const ExecutorInstallRequest = Schema.Struct({
  providerId: ExecutorProviderId,
  source: ExecutorIntegrationSource,
})
export type ExecutorInstallRequest = typeof ExecutorInstallRequest.Type

export const ExecutorToolPreviewRequest = ExecutorInstallRequest
export type ExecutorToolPreviewRequest = typeof ExecutorToolPreviewRequest.Type

export const ExecutorToolPreviewItem = Schema.Struct({
  name: NonBlankString,
  description: Schema.String,
})
export type ExecutorToolPreviewItem = typeof ExecutorToolPreviewItem.Type

export const ExecutorToolPreviewResponse = Schema.Struct({
  status: Schema.Literals([
    'ready',
    'authentication_required',
    'definition_missing',
    'unavailable',
  ]),
  tools: Schema.Array(ExecutorToolPreviewItem),
  toolCount: Schema.OptionFromOptionalKey(Schema.Number),
  message: Schema.String,
})
export type ExecutorToolPreviewResponse =
  typeof ExecutorToolPreviewResponse.Type

export const ExecutorAuthPlacement = Schema.Struct({
  carrier: Schema.Literals(['header', 'query', 'env']),
  name: NonBlankString,
  prefix: Schema.String,
  variable: NonBlankString,
})
export type ExecutorAuthPlacement = typeof ExecutorAuthPlacement.Type

export const ExecutorAuthMethodNone = Schema.Struct({
  kind: Schema.Literal('none'),
  id: NonBlankString,
  label: NonBlankString,
  template: NonBlankString,
})

export const ExecutorAuthMethodSecret = Schema.Struct({
  kind: Schema.Literal('secret'),
  id: NonBlankString,
  label: NonBlankString,
  template: NonBlankString,
  placements: Schema.Array(ExecutorAuthPlacement),
})

export const ExecutorAuthMethodOAuth = Schema.Struct({
  kind: Schema.Literal('oauth'),
  id: NonBlankString,
  label: NonBlankString,
  template: NonBlankString,
  authorizationUrl: OptionalHttpsUrl,
  tokenUrl: OptionalHttpsUrl,
  resource: OptionalHttpsUrl,
  scopes: Schema.Array(Schema.String),
})

export const ExecutorAuthMethod = Schema.Union([
  ExecutorAuthMethodNone,
  ExecutorAuthMethodSecret,
  ExecutorAuthMethodOAuth,
])
export type ExecutorAuthMethod = typeof ExecutorAuthMethod.Type
export type ExecutorSecretAuthMethod = typeof ExecutorAuthMethodSecret.Type
export type ExecutorOAuthAuthMethod = typeof ExecutorAuthMethodOAuth.Type
export const ExecutorSetupAuthMethod = Schema.Union([
  ExecutorAuthMethodSecret,
  ExecutorAuthMethodOAuth,
])
export type ExecutorSetupAuthMethod = typeof ExecutorSetupAuthMethod.Type

export const ExecutorInstallConnected = Schema.Struct({
  kind: Schema.Literal('connected'),
  slug: ExecutorIntegrationSlug,
})

export const ExecutorInstallOAuthReady = Schema.Struct({
  kind: Schema.Literal('oauth_ready'),
  slug: ExecutorIntegrationSlug,
  connectUrl: NonBlankString,
})

export const ExecutorInstallAuthorizationRedirect = Schema.Struct({
  kind: Schema.Literal('authorization_redirect'),
  slug: ExecutorIntegrationSlug,
  connectUrl: NonBlankString,
})

export const ExecutorInstallCredentialsRequired = Schema.Struct({
  kind: Schema.Literal('credentials_required'),
  slug: ExecutorIntegrationSlug,
  methods: Schema.NonEmptyArray(ExecutorAuthMethodSecret),
})

export const ExecutorInstallResponse = Schema.Union([
  ExecutorInstallConnected,
  ExecutorInstallOAuthReady,
  ExecutorInstallAuthorizationRedirect,
  ExecutorInstallCredentialsRequired,
])
export type ExecutorInstallResponse = typeof ExecutorInstallResponse.Type

export const ExecutorIntegrationStatus = Schema.Literals([
  'available',
  'connected',
  'degraded',
  'setup_required',
])
export type ExecutorIntegrationStatus = typeof ExecutorIntegrationStatus.Type

export const ExecutorIntegrationTool = Schema.Struct({
  address: ExecutorToolAddress,
  name: Schema.String,
  description: Schema.String,
})
export type ExecutorIntegrationTool = typeof ExecutorIntegrationTool.Type

export const ExecutorConnectionHealth = Schema.Struct({
  status: Schema.String,
  detail: OptionalString,
  checkedAt: Schema.Number,
})

export const ExecutorIntegrationConnection = Schema.Struct({
  owner: ExecutorConnectionOwner,
  name: Schema.String,
  address: ExecutorConnectionAddress,
  identityLabel: OptionalString,
  expiresAt: Schema.OptionFromOptionalKey(Schema.Number),
  health: Schema.OptionFromOptionalKey(ExecutorConnectionHealth),
})
export type ExecutorIntegrationConnection =
  typeof ExecutorIntegrationConnection.Type

export const ExecutorIntegrationItem = Schema.Struct({
  providerId: ExecutorProviderId,
  slug: ExecutorIntegrationSlug,
  label: NonBlankString,
  description: Schema.String,
  protocol: Schema.String,
  icon: OptionalHttpsUrl,
  displayUrl: OptionalHttpsUrl,
  status: ExecutorIntegrationStatus,
  canRemove: Schema.Boolean,
  canRefresh: Schema.Boolean,
  authMethods: Schema.Array(ExecutorAuthMethod),
  connections: Schema.Array(ExecutorIntegrationConnection),
  tools: Schema.Array(ExecutorIntegrationTool),
})
export type ExecutorIntegrationItem = typeof ExecutorIntegrationItem.Type

export const ExecutorConnectionsSnapshot = Schema.Struct({
  integrations: Schema.Array(ExecutorIntegrationItem),
})
export type ExecutorConnectionsSnapshot =
  typeof ExecutorConnectionsSnapshot.Type
