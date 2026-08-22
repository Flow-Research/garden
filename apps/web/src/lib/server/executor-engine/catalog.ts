import { Clock, Effect, Option, Result, Schema } from 'effect'
import { FetchHttpClient, type HttpClient } from 'effect/unstable/http'
import {
  ExecutorHttpsUrl,
  ExecutorIntegrationSlug,
  ExecutorIntegrationSource,
  ExecutorProviderDomain,
  ExecutorProviderId,
  ExecutorRegistryEntry,
  ExecutorRegistrySearchResponse,
  type ExecutorHttpsUrl as ExecutorHttpsUrlType,
  type ExecutorIntegrationSlug as ExecutorIntegrationSlugType,
  type ExecutorProviderDomain as ExecutorProviderDomainType,
  type ExecutorProviderId as ExecutorProviderIdType,
  type ExecutorRegistryEntry as ExecutorRegistryEntryType,
} from '@/lib/executor-contract'
import { logApiFailure } from '@/lib/server/api-logging'
import {
  gardenExecutorPresets,
  type GardenExecutorPreset,
  type GardenExecutorPresetProtocol,
} from './presets'
import {
  createIntegrationsShExtension,
  IntegrationsShDomainSurface,
  type IntegrationsShCatalogEntry,
  type IntegrationsShError,
} from './integrations-sh'

const parseCatalogUrl = (value: string): Option.Option<URL> =>
  Option.fromNullishOr(URL.parse(value))

const CatalogMcpCandidate = Schema.Struct({
  kind: Schema.Literal('mcp'),
  domain: ExecutorProviderDomain,
  slug: ExecutorIntegrationSlug,
  endpoint: Schema.Option(ExecutorHttpsUrl),
  bearerToken: Schema.Boolean,
})
export type CatalogMcpCandidate = typeof CatalogMcpCandidate.Type

const CatalogOpenApiCandidate = Schema.Struct({
  kind: Schema.Literal('openapi'),
  domain: ExecutorProviderDomain,
  slug: ExecutorIntegrationSlug,
  spec: Schema.Option(ExecutorHttpsUrl),
  baseUrl: Schema.Option(ExecutorHttpsUrl),
})
export type CatalogOpenApiCandidate = typeof CatalogOpenApiCandidate.Type

const CatalogPresetCandidate = Schema.Struct({
  kind: Schema.Literal('preset'),
  protocol: Schema.Literals(['openapi', 'mcp', 'graphql']),
  slug: ExecutorIntegrationSlug,
  presetId: Schema.String,
})
export type CatalogPresetCandidate = typeof CatalogPresetCandidate.Type

const CatalogAppCandidate = Schema.Struct({
  kind: Schema.Literal('app'),
  source: ExecutorIntegrationSource,
  slug: ExecutorIntegrationSlug,
})

export const CatalogCandidate = Schema.Union([
  CatalogMcpCandidate,
  CatalogOpenApiCandidate,
  CatalogPresetCandidate,
  CatalogAppCandidate,
])
export type CatalogCandidate = typeof CatalogCandidate.Type

export const CatalogProvider = Schema.Struct({
  providerId: ExecutorProviderId,
  installSlug: ExecutorIntegrationSlug,
  name: Schema.String,
  description: Schema.String,
  icon: Schema.Option(ExecutorHttpsUrl),
  domain: ExecutorProviderDomain,
  categories: Schema.Array(Schema.String),
  candidates: Schema.NonEmptyArray(CatalogCandidate),
  featured: Schema.Boolean,
})
export type CatalogProvider = typeof CatalogProvider.Type

export class CatalogProviderNotFoundError extends Schema.Error<CatalogProviderNotFoundError>(
  'CatalogProviderNotFoundError',
)({ providerId: ExecutorProviderId }) {}

export type ExecutorCatalogError =
  | IntegrationsShError
  | CatalogProviderNotFoundError

const integrations = createIntegrationsShExtension()

const decodeHttpsUrl = Schema.decodeUnknownOption(ExecutorHttpsUrl)
const decodeIntegrationSlug = Schema.decodeUnknownOption(
  ExecutorIntegrationSlug,
)
const decodeProviderId = Schema.decodeUnknownOption(ExecutorProviderId)
const decodeProviderDomain = Schema.decodeUnknownOption(ExecutorProviderDomain)

const decodeOptionalUrl = (
  value: Option.Option<string | null>,
): Option.Option<ExecutorHttpsUrlType> =>
  Option.flatMap(value, (url) => {
    if (url === null) return Option.none()
    return decodeHttpsUrl(url)
  })

const decodeOptionalStringUrl = (
  value: string | undefined,
): Option.Option<ExecutorHttpsUrlType> => {
  if (value === undefined) return Option.none()
  return decodeHttpsUrl(value)
}

const catalogCandidate = (
  entry: IntegrationsShCatalogEntry,
): Option.Option<CatalogCandidate> => {
  const slug = decodeIntegrationSlug(entry.slug)
  if (Option.isNone(slug)) return Option.none()
  if (entry.kind === 'mcp') {
    return Option.some(
      CatalogMcpCandidate.make({
        kind: 'mcp',
        domain: ExecutorProviderDomain.make(entry.domain.toLowerCase()),
        slug: slug.value,
        endpoint: decodeOptionalUrl(entry.url),
        bearerToken: false,
      }),
    )
  }
  if (entry.kind === 'openapi') {
    return Option.some(
      CatalogOpenApiCandidate.make({
        kind: 'openapi',
        domain: ExecutorProviderDomain.make(entry.domain.toLowerCase()),
        slug: slug.value,
        spec: decodeOptionalUrl(entry.spec),
        baseUrl: decodeOptionalUrl(entry.url),
      }),
    )
  }
  return Option.none()
}

const candidatePriority: Record<CatalogCandidate['kind'], number> = {
  app: 0,
  preset: 1,
  mcp: 2,
  openapi: 3,
}

const presetPriority: Record<GardenExecutorPresetProtocol, number> = {
  mcp: 0,
  openapi: 1,
  graphql: 2,
}

const candidateOrder = (
  candidate: CatalogCandidate,
  comparison: CatalogCandidate,
): number => {
  if (candidate.kind === 'preset' && comparison.kind === 'preset') {
    return (
      presetPriority[candidate.protocol] - presetPriority[comparison.protocol]
    )
  }
  return candidatePriority[candidate.kind] - candidatePriority[comparison.kind]
}

const providerFromEntries = (
  entries: readonly IntegrationsShCatalogEntry[],
): Option.Option<CatalogProvider> => {
  const seed = entries[0]
  if (seed === undefined) return Option.none()
  const providerId = decodeProviderId(seed.domain.toLowerCase())
  const domain = decodeProviderDomain(seed.domain.toLowerCase())
  if (Option.isNone(providerId) || Option.isNone(domain)) return Option.none()

  const candidates = entries.flatMap((entry) => {
    const candidate = catalogCandidate(entry)
    if (Option.isNone(candidate)) return []
    return [candidate.value]
  })
  candidates.sort(candidateOrder)
  const first = candidates[0]
  if (first === undefined) return Option.none()

  return Option.some(
    CatalogProvider.make({
      providerId: providerId.value,
      installSlug: first.slug,
      name: seed.name,
      description: seed.description,
      icon: decodeOptionalUrl(seed.icon),
      domain: domain.value,
      categories: seed.categories,
      candidates: [first, ...candidates.slice(1)],
      featured: false,
    }),
  )
}

const providersFromEntries = (
  entries: readonly IntegrationsShCatalogEntry[],
): readonly CatalogProvider[] => {
  const grouped = new Map<string, IntegrationsShCatalogEntry[]>()
  for (const entry of entries) {
    if (entry.kind !== 'mcp' && entry.kind !== 'openapi') continue
    const key = entry.domain.toLowerCase()
    const current = grouped.get(key) ?? []
    current.push(entry)
    grouped.set(key, current)
  }

  return [...grouped.values()].flatMap((providerEntries) => {
    const provider = providerFromEntries(providerEntries)
    if (Option.isNone(provider)) return []
    return [provider.value]
  })
}

const integrationsLogoDomain = (
  icon: string | undefined,
): Option.Option<ExecutorProviderDomainType> => {
  if (icon === undefined) return Option.none()
  const parsed = parseCatalogUrl(icon)
  if (Option.isNone(parsed) || parsed.value.hostname !== 'integrations.sh') {
    return Option.none()
  }
  const prefix = '/logo/'
  if (!parsed.value.pathname.startsWith(prefix)) return Option.none()
  return decodeProviderDomain(
    parsed.value.pathname.slice(prefix.length).toLowerCase(),
  )
}

const presetDomain = (
  preset: GardenExecutorPreset,
): ExecutorProviderDomainType => {
  if (preset.family === 'google') {
    return ExecutorProviderDomain.make('google.com')
  }
  if (preset.family === 'microsoft') {
    return ExecutorProviderDomain.make('microsoft.com')
  }
  const iconDomain = integrationsLogoDomain(preset.icon)
  if (Option.isSome(iconDomain)) return iconDomain.value

  const parsed = parseCatalogUrl(preset.url)
  if (Option.isNone(parsed)) {
    return ExecutorProviderDomain.make('executor.local')
  }
  const hostname = parsed.value.hostname
    .toLowerCase()
    .replace(/^(?:api|mcp|www)\./, '')
  const decoded = decodeProviderDomain(hostname)
  if (Option.isSome(decoded)) return decoded.value
  return ExecutorProviderDomain.make('executor.local')
}

const presetProviders = (): readonly CatalogProvider[] => {
  const grouped = new Map<string, GardenExecutorPreset[]>()
  for (const preset of gardenExecutorPresets) {
    const current = grouped.get(preset.slug) ?? []
    current.push(preset)
    grouped.set(preset.slug, current)
  }

  return [...grouped.entries()].flatMap(([slug, presets]) => {
    const ordered = [...presets].sort(
      (preset, comparison) =>
        presetPriority[preset.protocol] - presetPriority[comparison.protocol],
    )
    const seed = ordered[0]
    if (seed === undefined) return []
    const candidates = ordered.map((preset) =>
      CatalogPresetCandidate.make({
        kind: 'preset',
        protocol: preset.protocol,
        slug: ExecutorIntegrationSlug.make(slug),
        presetId: preset.id,
      }),
    )
    const first = candidates[0]
    if (first === undefined) return []
    const categories = new Set<string>(['executor', seed.protocol])
    for (const preset of ordered) {
      categories.add(preset.protocol)
      if (preset.family !== undefined) categories.add(preset.family)
    }

    return [
      CatalogProvider.make({
        providerId: ExecutorProviderId.make(`executor:${slug}`),
        installSlug: ExecutorIntegrationSlug.make(slug),
        name: seed.name,
        description: seed.summary,
        icon: decodeOptionalStringUrl(seed.icon),
        domain: presetDomain(seed),
        categories: [...categories],
        candidates: [first, ...candidates.slice(1)],
        featured: ordered.some((preset) => preset.featured),
      }),
    ]
  })
}

const nativeProvider = (input: {
  readonly providerId: string
  readonly slug: string
  readonly name: string
  readonly description: string
  readonly icon: string
  readonly domain: string
  readonly categories: readonly string[]
}): CatalogProvider => {
  const candidate = CatalogAppCandidate.make({
    kind: 'app',
    source: 'native',
    slug: ExecutorIntegrationSlug.make(input.slug),
  })
  return CatalogProvider.make({
    providerId: ExecutorProviderId.make(input.providerId),
    installSlug: candidate.slug,
    name: input.name,
    description: input.description,
    icon: Option.some(ExecutorHttpsUrl.make(input.icon)),
    domain: ExecutorProviderDomain.make(input.domain),
    categories: input.categories,
    candidates: [candidate],
    featured: true,
  })
}

const githubProvider = nativeProvider({
  providerId: 'github.com',
  slug: 'github',
  name: 'GitHub',
  description:
    'Install the Garden GitHub App for repository-scoped issues, pull requests, code, and webhooks.',
  icon: 'https://svgl.app/library/github_dark.svg',
  domain: 'github.com',
  categories: ['developer-tools', 'source-control'],
})

const githubMcpCandidate = CatalogMcpCandidate.make({
  kind: 'mcp',
  domain: ExecutorProviderDomain.make('github.com'),
  slug: ExecutorIntegrationSlug.make('github--mcp'),
  endpoint: Option.some(
    ExecutorHttpsUrl.make('https://api.githubcopilot.com/mcp/'),
  ),
  bearerToken: true,
})

const rawServerOwnedProviders: readonly CatalogProvider[] = [
  ...presetProviders(),
  CatalogProvider.make({
    ...githubProvider,
    candidates: [githubProvider.candidates[0], githubMcpCandidate],
  }),
  nativeProvider({
    providerId: 'discord.com',
    slug: 'discord',
    name: 'Discord',
    description:
      'Install the Garden Discord bot for server messages, channels, members, and moderation.',
    icon: 'https://integrations.sh/logo/discord.com',
    domain: 'discord.com',
    categories: ['communication'],
  }),
]

const serverOwnedProviders: readonly CatalogProvider[] = [
  ...rawServerOwnedProviders
    .reduce((providersById, provider) => {
      const providerId = String(provider.providerId)
      const existing = providersById.get(providerId)
      if (existing === undefined) {
        providersById.set(providerId, provider)
        return providersById
      }
      const candidatesByKey = [
        ...existing.candidates,
        ...provider.candidates,
      ].reduce((candidates, candidate) => {
        const protocol =
          candidate.kind === 'preset' ? candidate.protocol : candidate.kind
        candidates.set(`${protocol}:${String(candidate.slug)}`, candidate)
        return candidates
      }, new Map<string, CatalogCandidate>())
      const [firstCandidate, ...remainingCandidates] = Array.from(
        candidatesByKey.values(),
      ).sort(candidateOrder)
      if (firstCandidate === undefined) return providersById
      providersById.set(
        providerId,
        CatalogProvider.make({
          ...existing,
          description: provider.description,
          icon: Option.orElse(existing.icon, () => provider.icon),
          categories: [
            ...new Set([...existing.categories, ...provider.categories]),
          ],
          candidates: [firstCandidate, ...remainingCandidates],
          featured: existing.featured || provider.featured,
        }),
      )
      return providersById
    }, new Map<string, CatalogProvider>())
    .values(),
]

/** Returns the in-process provider registry used by installed-connection
 * reads. This deliberately avoids integrations.sh: a workspace snapshot must
 * never wait on catalog discovery before the rest of the app can render. */
export const listServerOwnedExecutorProviders =
  (): readonly CatalogProvider[] => serverOwnedProviders

const providerIdentityToken = (value: string): string =>
  value
    .toLowerCase()
    .replace(/^(?:google|microsoft)\s+/, '')
    .replace(/[^a-z0-9]/g, '')

const providerDomainToken = (domain: ExecutorProviderDomainType): string =>
  providerIdentityToken(String(domain).split('.')[0] ?? '')

const providersRepresentSameProduct = (
  provider: CatalogProvider,
  discovered: CatalogProvider,
): boolean => {
  if (provider.domain === discovered.domain) return true
  const providerName = providerIdentityToken(provider.name)
  if (providerName.length < 3) return false
  return (
    providerName === providerIdentityToken(discovered.name) ||
    providerName === providerDomainToken(discovered.domain)
  )
}

const discoveredProviderOrder = (
  provider: CatalogProvider,
  comparison: CatalogProvider,
): number => {
  const providerHasMcp = provider.candidates.some(
    (candidate) => catalogCandidateSource(candidate) === 'mcp',
  )
  const comparisonHasMcp = comparison.candidates.some(
    (candidate) => catalogCandidateSource(candidate) === 'mcp',
  )
  if (providerHasMcp !== comparisonHasMcp) return providerHasMcp ? -1 : 1
  return comparison.candidates.length - provider.candidates.length
}

/** Build one canonical provider from server-owned install policy and every
 * discovered product source. Matching is product-aware so regional hosts and
 * product API domains do not split MCP, OpenAPI, GraphQL, and native sources
 * into separate cards. Candidate order controls installation fallback only. */
export const projectExecutorProviders = (
  entries: readonly IntegrationsShCatalogEntry[],
): readonly CatalogProvider[] => {
  const discovered = providersFromEntries(entries)
  const consumedDiscoveredProviderIds = new Set<string>()
  const mergedServerOwned = serverOwnedProviders.map((provider) => {
    const discoveredProviders = discovered
      .filter(
        (candidate) =>
          !consumedDiscoveredProviderIds.has(String(candidate.providerId)) &&
          providersRepresentSameProduct(provider, candidate),
      )
      .sort(discoveredProviderOrder)
    if (discoveredProviders.length === 0) return provider
    for (const discoveredProvider of discoveredProviders) {
      consumedDiscoveredProviderIds.add(String(discoveredProvider.providerId))
    }

    const candidates = [
      ...provider.candidates,
      ...discoveredProviders.flatMap(
        (discoveredProvider) => discoveredProvider.candidates,
      ),
    ]
    candidates.sort(candidateOrder)
    const first = candidates[0]
    const preferredDiscoveryProvider = discoveredProviders[0]
    if (first === undefined || preferredDiscoveryProvider === undefined) {
      return provider
    }
    return CatalogProvider.make({
      ...provider,
      domain: preferredDiscoveryProvider.domain,
      categories: [
        ...new Set([
          ...provider.categories,
          ...discoveredProviders.flatMap(
            (discoveredProvider) => discoveredProvider.categories,
          ),
        ]),
      ],
      candidates: [first, ...candidates.slice(1)],
    })
  })

  const reservedProviderIds = new Set(
    serverOwnedProviders.map((provider) => String(provider.providerId)),
  )
  const remainingDiscovered = discovered.filter(
    (provider) =>
      !consumedDiscoveredProviderIds.has(String(provider.providerId)) &&
      !reservedProviderIds.has(String(provider.providerId)),
  )
  return [...mergedServerOwned, ...remainingDiscovered]
}

export const catalogCandidateSource = (
  candidate: CatalogCandidate,
): ExecutorIntegrationSource => {
  if (candidate.kind === 'app') return candidate.source
  if (candidate.kind === 'preset') return candidate.protocol
  return candidate.kind
}

export const catalogCandidateDomain = (
  candidate: CatalogCandidate,
): Option.Option<ExecutorProviderDomainType> => {
  if (candidate.kind === 'mcp' || candidate.kind === 'openapi') {
    return Option.some(candidate.domain)
  }
  return Option.none()
}

export const providerSourceInstallSlug = (
  provider: CatalogProvider,
  source: ExecutorIntegrationSource,
): ExecutorIntegrationSlugType => {
  const sources = new Set(provider.candidates.map(catalogCandidateSource))
  const primarySource = catalogCandidateSource(provider.candidates[0])
  if (sources.size === 1 || source === primarySource) {
    return provider.installSlug
  }
  return ExecutorIntegrationSlug.make(`${provider.installSlug}--${source}`)
}

const publicRegistryEntry = (
  provider: CatalogProvider,
): ExecutorRegistryEntryType => {
  const firstSource = catalogCandidateSource(provider.candidates[0])
  const remainingSources = provider.candidates
    .slice(1)
    .map(catalogCandidateSource)
    .filter((source) => source !== firstSource)
  return ExecutorRegistryEntry.make({
    providerId: provider.providerId,
    name: provider.name,
    description: provider.description,
    icon: provider.icon,
    domain: provider.domain,
    categories: provider.categories,
    sources: [firstSource, ...new Set(remainingSources)],
  })
}

const providerNameOrder = (
  provider: CatalogProvider,
  comparison: CatalogProvider,
): number => provider.name.localeCompare(comparison.name)

const withHttpClient = <A, E>(
  effect: Effect.Effect<A, E, HttpClient.HttpClient>,
): Effect.Effect<A, E> => Effect.provide(effect, FetchHttpClient.layer)

export const listExecutorProviders = Effect.fn('ExecutorCatalog.list')(
  function* () {
    const catalog = yield* Effect.result(withHttpClient(integrations.catalog()))
    if (Result.isFailure(catalog)) {
      logApiFailure({
        event: 'executor.catalog.list_degraded',
        error: catalog.failure,
        level: 'warn',
      })
      return serverOwnedProviders
    }
    return projectExecutorProviders(catalog.success.data)
  },
)

export const getExecutorProvider = Effect.fn('ExecutorCatalog.getProvider')(
  function* (providerId: ExecutorProviderIdType) {
    const providers = yield* listExecutorProviders()
    const provider = providers.find(
      (candidate) => candidate.providerId === providerId,
    )
    if (provider !== undefined) return provider
    return yield* new CatalogProviderNotFoundError({ providerId })
  },
)

export const getExecutorCatalogSurface = Effect.fn(
  'ExecutorCatalog.getSurface',
)(function* (domain: ExecutorProviderDomainType) {
  return yield* withHttpClient(integrations.surface(String(domain)))
})

/** Resolve every discovery domain represented by a provider source. The
 * combined document preserves candidate slugs, so installation never borrows
 * an endpoint or specification from a sibling protocol or product host. */
export const getExecutorCatalogSurfaces = Effect.fn(
  'ExecutorCatalog.getSurfaces',
)(function* (candidates: readonly CatalogCandidate[]) {
  const domains = [
    ...new Set(
      candidates.flatMap((candidate) =>
        Option.match(catalogCandidateDomain(candidate), {
          onNone: () => [],
          onSome: (domain) => [String(domain)],
        }),
      ),
    ),
  ]
  const documents = yield* Effect.forEach(
    domains,
    (domain) => getExecutorCatalogSurface(ExecutorProviderDomain.make(domain)),
    { concurrency: 4 },
  )
  return IntegrationsShDomainSurface.make({
    domain: domains.join(','),
    description: Option.none(),
    summary: Option.none(),
    surfaces: documents.flatMap((document) => document.surfaces),
  })
})

export const searchExecutorCatalog = Effect.fn('ExecutorCatalog.search')(
  function* (input: {
    readonly query: string
    readonly category: string
    readonly limit: number
    readonly offset: number
  }) {
    const catalog = yield* withHttpClient(integrations.catalog())
    const providers = projectExecutorProviders(catalog.data)
    const matches = providers
      .filter((provider) => {
        if (input.category.length === 0) return true
        return provider.categories.includes(input.category)
      })
      .filter((provider) => {
        if (input.query.length === 0) return true
        const values = [
          provider.name,
          String(provider.providerId),
          String(provider.domain),
          provider.description,
        ]
        return values.some((value) => value.toLowerCase().includes(input.query))
      })
    matches.sort(providerNameOrder)

    const page = matches.slice(input.offset, input.offset + input.limit)
    const next = input.offset + page.length
    let nextOffset = Option.none<number>()
    if (next < matches.length) nextOffset = Option.some(next)
    return ExecutorRegistrySearchResponse.make({
      entries: page.map(publicRegistryEntry),
      total: matches.length,
      catalogSize: Option.some(catalog.data.length),
      fetchedAt: catalog.generatedAt,
      nextOffset,
    })
  },
)

export const getFeaturedExecutorCatalog = Effect.fn('ExecutorCatalog.featured')(
  function* () {
    const now = yield* Clock.currentTimeMillis
    const featured = serverOwnedProviders.filter(
      (provider) => provider.featured,
    )
    featured.sort(providerNameOrder)
    return ExecutorRegistrySearchResponse.make({
      entries: featured.map(publicRegistryEntry),
      total: featured.length,
      catalogSize: Option.none(),
      fetchedAt: new Date(now).toISOString(),
      nextOffset: Option.none(),
    })
  },
)
