import { Effect, Option, Schema } from 'effect'
import {
  AuthTemplateSlug,
  ConnectionName,
  IntegrationSlug,
  type Integration,
} from '@executor-js/sdk/core'
import {
  variable,
  type ApiKeyAuthTemplate,
  type McpAuthMethodInput,
} from '@executor-js/plugin-mcp/core'
import {
  ExecutorInstallConnected,
  ExecutorInstallCredentialsRequired,
  ExecutorInstallOAuthReady,
  ExecutorIntegrationSlug,
  type ExecutorInstallResponse,
  type ExecutorIntegrationSource,
  type ExecutorOAuthAuthMethod,
  type ExecutorSecretAuthMethod,
  type ExecutorSetupAuthMethod,
} from '@/lib/executor-contract'
import {
  type CatalogCandidate,
  type CatalogMcpCandidate,
  type CatalogOpenApiCandidate,
  type CatalogPresetCandidate,
  catalogCandidateSource,
  CatalogProvider,
  providerSourceInstallSlug,
} from '@/lib/server/executor-engine/catalog'
import { modelExecutorAuthMethods } from '@/lib/server/executor-engine/auth-contract'
import type { GardenExecutor } from '@/lib/server/executor-runtime'
import type {
  IntegrationsShDomainSurface,
  IntegrationsShSurface,
} from './integrations-sh'
import { getGardenExecutorPreset } from './presets'

export interface McpTarget {
  readonly kind: 'mcp'
  readonly endpoint: string
  readonly transport: 'sse' | 'streamable-http'
}

export interface OpenApiTarget {
  readonly kind: 'openapi'
  readonly spec: string
  readonly baseUrl: Option.Option<string>
}

export interface PresetTarget {
  readonly kind: 'preset'
  readonly protocol: 'openapi' | 'graphql'
  readonly presetId: string
}

export type InstallTarget = McpTarget | OpenApiTarget | PresetTarget

export class ExecutorInstallUnavailableError extends Schema.ErrorClass<ExecutorInstallUnavailableError>(
  'ExecutorInstallUnavailableError',
)({ reasons: Schema.NonEmptyArray(Schema.String) }) {}

class ExecutorCandidateError extends Schema.ErrorClass<ExecutorCandidateError>(
  'ExecutorCandidateError',
)({ reason: Schema.String }) {}

const ActionableExecutorError = Schema.Struct({
  __executorUserActionable: Schema.Literal(true),
  userMessage: Schema.String,
})

const actionableMessage = (failure: unknown, fallback: string): string =>
  Option.match(Schema.decodeUnknownOption(ActionableExecutorError)(failure), {
    onNone: () => fallback,
    onSome: (error) => error.userMessage,
  })

const matchingSurface = (
  document: IntegrationsShDomainSurface,
  kind: 'mcp' | 'openapi',
  slug: string,
): Option.Option<IntegrationsShSurface> => {
  let surfaceType = 'http'
  if (kind === 'mcp') surfaceType = 'mcp'
  const matching = document.surfaces.filter(
    (surface) => surface.type === surfaceType,
  )
  return Option.fromNullishOr(matching.find((surface) => surface.slug === slug))
}

const mcpTransport = (
  surface: Option.Option<IntegrationsShSurface>,
): 'sse' | 'streamable-http' => {
  if (Option.isNone(surface)) return 'streamable-http'
  const transports = surface.value.transports
  if (transports.includes('sse') && !transports.includes('streamable-http')) {
    return 'sse'
  }
  return 'streamable-http'
}

const mcpTarget = (
  candidate: CatalogMcpCandidate,
  document: IntegrationsShDomainSurface,
): Option.Option<McpTarget> => {
  const surface = matchingSurface(document, 'mcp', String(candidate.slug))
  const surfaceEndpoint = Option.flatMap(surface, (value) => value.endpoint)
  const endpoint = Option.orElse(surfaceEndpoint, () => candidate.endpoint)
  if (Option.isNone(endpoint)) return Option.none()
  return Option.some({
    kind: 'mcp',
    endpoint: String(endpoint.value),
    transport: mcpTransport(surface),
  })
}

const openApiTarget = (
  candidate: CatalogOpenApiCandidate,
  document: IntegrationsShDomainSurface,
): Option.Option<InstallTarget> => {
  const surface = matchingSurface(document, 'openapi', String(candidate.slug))
  const surfaceSpec = Option.flatMap(surface, (value) => value.spec)
  const spec = Option.orElse(surfaceSpec, () => candidate.spec)
  if (Option.isSome(spec)) {
    const surfaceBaseUrl = Option.flatMap(surface, (value) => value.endpoint)
    return Option.some({
      kind: 'openapi',
      spec: String(spec.value),
      baseUrl: Option.map(
        Option.orElse(surfaceBaseUrl, () => candidate.baseUrl),
        String,
      ),
    })
  }

  return Option.none()
}

const presetTarget = (
  candidate: CatalogPresetCandidate,
): Option.Option<InstallTarget> => {
  const preset = getGardenExecutorPreset(candidate.protocol, candidate.presetId)
  if (preset === undefined) return Option.none()
  if (preset.protocol === 'mcp') {
    return Option.some({
      kind: 'mcp',
      endpoint: preset.preset.endpoint,
      transport: 'streamable-http',
    })
  }
  return Option.some({
    kind: 'preset',
    protocol: preset.protocol,
    presetId: preset.id,
  })
}

export const resolveInstallTarget = (
  candidate: CatalogCandidate,
  document: IntegrationsShDomainSurface,
): Option.Option<InstallTarget> => {
  if (candidate.kind === 'mcp') return mcpTarget(candidate, document)
  if (candidate.kind === 'preset') return presetTarget(candidate)
  if (candidate.kind === 'app') return Option.none()
  return openApiTarget(candidate, document)
}

const bearerTemplate = (): ApiKeyAuthTemplate => ({
  slug: 'bearer',
  type: 'apiKey',
  label: 'Access token',
  headers: {
    Authorization: ['Bearer ', variable('token')],
  },
})

const mcpAuthenticationTemplates = Effect.fn(
  'ExecutorInstall.mcpAuthenticationTemplates',
)(function* (
  executor: GardenExecutor,
  candidate: CatalogCandidate,
  endpoint: string,
) {
  if (candidate.kind === 'mcp' && candidate.bearerToken) {
    const templates: readonly McpAuthMethodInput[] = [bearerTemplate()]
    return templates
  }

  const probe = yield* executor.mcp.probeEndpoint({ endpoint })
  if (probe.requiresOAuth) {
    const templates: readonly McpAuthMethodInput[] = [
      { slug: 'oauth2', kind: 'oauth2' },
    ]
    return templates
  }
  if (probe.requiresAuthentication) {
    const templates: readonly McpAuthMethodInput[] = [
      {
        slug: 'header',
        type: 'apiKey',
        label: 'Bearer token',
        headers: {
          Authorization: ['Bearer ', variable('token')],
        },
      },
    ]
    return templates
  }
  const templates: readonly McpAuthMethodInput[] = [
    { slug: 'none', kind: 'none' },
  ]
  return templates
})

const installOutcome = (
  integration: Integration,
  methods: readonly ExecutorSetupAuthMethod[],
): Option.Option<ExecutorInstallResponse> => {
  const slug = ExecutorIntegrationSlug.make(String(integration.slug))
  const oauth = methods.find(
    (method): method is ExecutorOAuthAuthMethod => method.kind === 'oauth',
  )
  if (oauth !== undefined) {
    return Option.some(
      ExecutorInstallOAuthReady.make({
        kind: 'oauth_ready',
        slug,
        connectUrl: `/api/executor/oauth/start?integration=${encodeURIComponent(slug)}`,
      }),
    )
  }

  const secrets = methods.filter(
    (method): method is ExecutorSecretAuthMethod => method.kind === 'secret',
  )
  const first = secrets[0]
  if (first === undefined) return Option.none()
  return Option.some(
    ExecutorInstallCredentialsRequired.make({
      kind: 'credentials_required',
      slug,
      methods: [first, ...secrets.slice(1)],
    }),
  )
}

const finalizeIntegration = Effect.fn('ExecutorInstall.finalize')(function* (
  executor: GardenExecutor,
  integration: Integration,
) {
  const connections = yield* executor.connections.list({
    integration: integration.slug,
  })
  const slug = ExecutorIntegrationSlug.make(String(integration.slug))
  if (connections.length > 0) {
    return ExecutorInstallConnected.make({ kind: 'connected', slug })
  }

  const noAuthMethod = integration.authMethods.find(
    (method) => method.kind === 'none',
  )
  if (noAuthMethod !== undefined || integration.authMethods.length === 0) {
    const connection = yield* executor.connections.create({
      owner: 'org',
      name: ConnectionName.make('default'),
      integration: integration.slug,
      template: AuthTemplateSlug.make(noAuthMethod?.template ?? 'none'),
      values: {},
    })
    if (integration.canRefresh) {
      yield* executor.connections.refresh(connection)
    }
    return ExecutorInstallConnected.make({ kind: 'connected', slug })
  }

  const modeledMethods = modelExecutorAuthMethods(integration)
  const methods = modeledMethods.filter(
    (method): method is ExecutorSetupAuthMethod => method.kind !== 'none',
  )
  const outcome = installOutcome(integration, methods)
  if (Option.isSome(outcome)) return outcome.value
  return yield* new ExecutorCandidateError({
    reason: 'Integration did not publish a usable authentication method.',
  })
})

const registerTarget = Effect.fn('ExecutorInstall.registerTarget')(function* (
  executor: GardenExecutor,
  provider: CatalogProvider,
  candidate: CatalogCandidate,
  target: InstallTarget,
) {
  if (target.kind === 'mcp') {
    const authenticationTemplate = yield* mcpAuthenticationTemplates(
      executor,
      candidate,
      target.endpoint,
    )
    yield* executor.mcp.addServer({
      name: provider.name,
      description: provider.description,
      endpoint: target.endpoint,
      remoteTransport: target.transport,
      slug: String(provider.installSlug),
      authenticationTemplate,
    })
    return
  }

  if (target.kind === 'preset') {
    const configured = getGardenExecutorPreset(target.protocol, target.presetId)
    if (configured === undefined) {
      return yield* new ExecutorCandidateError({
        reason: 'The server-owned Executor preset is unavailable.',
      })
    }

    if (configured.protocol === 'openapi') {
      const preset = configured.preset
      if (preset.url === undefined) {
        return yield* new ExecutorCandidateError({
          reason: 'The server-owned OpenAPI preset has no specification.',
        })
      }
      yield* executor.openapi.addSpec({
        spec: { kind: 'url', url: preset.url },
        slug: String(provider.installSlug),
        name: preset.name,
        description: preset.summary,
        specFormat: preset.specFormat,
        family: preset.family,
        healthCheck: preset.healthCheck,
        authenticationTemplate: preset.authTemplate?.flatMap((authentication) =>
          authentication.kind === 'oauth2' ? [authentication] : [],
        ),
      })
      return
    }

    if (configured.id === 'anilist') {
      yield* executor.graphql.addIntegration({
        endpoint: configured.preset.endpoint,
        slug: String(provider.installSlug),
        name: configured.name,
        description: configured.summary,
        authenticationTemplate: [{ slug: 'none', kind: 'none' }],
      })
      return
    }

    yield* executor.graphql.addIntegration({
      endpoint: configured.preset.endpoint,
      slug: String(provider.installSlug),
      name: configured.name,
      description: configured.summary,
      authenticationTemplate: [
        {
          slug: 'header',
          type: 'apiKey',
          label: 'Access token',
          headers: { Authorization: [variable('token')] },
        },
        {
          slug: 'bearer',
          type: 'apiKey',
          label: 'Bearer token',
          headers: { Authorization: ['Bearer ', variable('token')] },
        },
      ],
    })
    return
  }

  const input = {
    spec: { kind: 'url' as const, url: target.spec },
    slug: String(provider.installSlug),
    name: provider.name,
    description: provider.description,
  }
  if (Option.isSome(target.baseUrl)) {
    yield* executor.openapi.addSpec({
      ...input,
      baseUrl: target.baseUrl.value,
    })
    return
  }
  yield* executor.openapi.addSpec(input)
})

const attemptCandidate = Effect.fn('ExecutorInstall.attemptCandidate')(
  function* (
    executor: GardenExecutor,
    provider: CatalogProvider,
    document: IntegrationsShDomainSurface,
    candidate: CatalogCandidate,
  ) {
    const target = resolveInstallTarget(candidate, document)
    if (Option.isNone(target)) {
      return yield* new ExecutorCandidateError({
        reason: `No installable ${candidate.kind} surface is available.`,
      })
    }

    let created = false
    const operation = Effect.fn('ExecutorInstall.candidateOperation')(
      function* () {
        yield* registerTarget(executor, provider, candidate, target.value)
        created = true
        const integration = yield* executor.integrations.get(
          IntegrationSlug.make(String(provider.installSlug)),
        )
        if (integration === null) {
          return yield* new ExecutorCandidateError({
            reason: 'Executor did not register the integration.',
          })
        }
        return yield* finalizeIntegration(executor, integration)
      },
    )

    const outcome = yield* Effect.match(operation(), {
      onFailure: (failure) => ({ kind: 'failure' as const, failure }),
      onSuccess: (response) => ({ kind: 'success' as const, response }),
    })
    if (outcome.kind === 'success') return outcome.response

    if (created) {
      const rollback = yield* Effect.match(
        executor.integrations.remove(
          IntegrationSlug.make(String(provider.installSlug)),
        ),
        {
          onFailure: () => false,
          onSuccess: () => true,
        },
      )
      if (!rollback) {
        return yield* new ExecutorInstallUnavailableError({
          reasons: [
            'A partial integration could not be rolled back; fallback stopped.',
          ],
        })
      }
    }

    return yield* new ExecutorCandidateError({
      reason: actionableMessage(
        outcome.failure,
        `Garden could not install this ${candidate.kind} integration.`,
      ),
    })
  },
)

/** Resolve, register, compensate, and classify one server-owned provider. */
export const installProvider = Effect.fn('ExecutorInstall.installProvider')(
  function* (
    executor: GardenExecutor,
    provider: CatalogProvider,
    document: IntegrationsShDomainSurface,
    source: ExecutorIntegrationSource,
  ) {
    const installSlug = providerSourceInstallSlug(provider, source)
    const sourceProvider = CatalogProvider.make({
      ...provider,
      installSlug,
    })
    const existing = yield* executor.integrations.get(
      IntegrationSlug.make(String(installSlug)),
    )
    if (existing !== null) {
      return yield* finalizeIntegration(executor, existing)
    }

    const selectedCandidates = provider.candidates.filter(
      (candidate) => catalogCandidateSource(candidate) === source,
    )
    const reasons: string[] = []
    for (const candidate of selectedCandidates) {
      const outcome = yield* Effect.match(
        attemptCandidate(executor, sourceProvider, document, candidate),
        {
          onFailure: (failure) => ({ kind: 'failure' as const, failure }),
          onSuccess: (response) => ({ kind: 'success' as const, response }),
        },
      )
      if (outcome.kind === 'success') return outcome.response
      if (outcome.failure instanceof ExecutorInstallUnavailableError) {
        return yield* outcome.failure
      }
      reasons.push(outcome.failure.reason)
    }

    const uniqueReasons = [...new Set(reasons)]
    const first = uniqueReasons[0]
    if (first === undefined) {
      return yield* new ExecutorInstallUnavailableError({
        reasons: ['No supported provider surface could be installed.'],
      })
    }
    return yield* new ExecutorInstallUnavailableError({
      reasons: [first, ...uniqueReasons.slice(1)],
    })
  },
)
