import { Cache, Duration, Effect, Exit, Option, Schema } from 'effect'
import { HttpClient, HttpClientRequest } from 'effect/unstable/http'

export const INTEGRATIONS_SH_BASE_URL = 'https://integrations.sh'
export const INTEGRATIONS_SH_CATALOG_URL = `${INTEGRATIONS_SH_BASE_URL}/api.json`

export const IntegrationsShCatalogEntry = Schema.Struct({
  id: Schema.String,
  kind: Schema.String,
  slug: Schema.String,
  name: Schema.String,
  description: Schema.String,
  url: Schema.OptionFromOptionalKey(Schema.NullOr(Schema.String)),
  spec: Schema.OptionFromOptionalKey(Schema.String),
  icon: Schema.OptionFromOptionalKey(Schema.NullOr(Schema.String)),
  domain: Schema.String,
  categories: Schema.Array(Schema.String),
  popularity: Schema.OptionFromOptionalKey(Schema.NullOr(Schema.Number)),
})
export type IntegrationsShCatalogEntry = typeof IntegrationsShCatalogEntry.Type

export const IntegrationsShCatalog = Schema.Struct({
  generatedAt: Schema.String,
  data: Schema.Array(IntegrationsShCatalogEntry),
})
export type IntegrationsShCatalog = typeof IntegrationsShCatalog.Type

const IntegrationsShExternalSurface = Schema.Struct({
  type: Schema.String,
  slug: Schema.String,
  name: Schema.String,
  url: Schema.OptionFromOptionalKey(Schema.String),
  spec: Schema.OptionFromOptionalKey(Schema.String),
  transports: Schema.OptionFromOptionalKey(Schema.Array(Schema.String)),
  docs: Schema.OptionFromOptionalKey(Schema.String),
})

const IntegrationsShExternalSurfaceDocument = Schema.Struct({
  domain: Schema.String,
  description: Schema.OptionFromOptionalKey(Schema.String),
  summary: Schema.OptionFromOptionalKey(Schema.String),
  surfaces: Schema.Array(IntegrationsShExternalSurface),
})

export const IntegrationsShSurface = Schema.Struct({
  type: Schema.String,
  slug: Schema.String,
  name: Schema.String,
  endpoint: Schema.Option(Schema.String),
  spec: Schema.Option(Schema.String),
  transports: Schema.Array(Schema.String),
  docs: Schema.Option(Schema.String),
})
export type IntegrationsShSurface = typeof IntegrationsShSurface.Type

export const IntegrationsShDomainSurface = Schema.Struct({
  domain: Schema.String,
  description: Schema.Option(Schema.String),
  summary: Schema.Option(Schema.String),
  surfaces: Schema.Array(IntegrationsShSurface),
})
export type IntegrationsShDomainSurface =
  typeof IntegrationsShDomainSurface.Type

export class IntegrationsShTransportError extends Schema.ErrorClass<IntegrationsShTransportError>(
  'IntegrationsShTransportError',
)({
  operation: Schema.String,
  url: Schema.String,
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

export class IntegrationsShHttpError extends Schema.ErrorClass<IntegrationsShHttpError>(
  'IntegrationsShHttpError',
)({
  operation: Schema.String,
  url: Schema.String,
  status: Schema.Number,
}) {}

export class IntegrationsShDecodeError extends Schema.ErrorClass<IntegrationsShDecodeError>(
  'IntegrationsShDecodeError',
)({
  operation: Schema.String,
  message: Schema.String,
}) {}

export type IntegrationsShError =
  | IntegrationsShTransportError
  | IntegrationsShHttpError
  | IntegrationsShDecodeError

export interface IntegrationsShExtension {
  readonly catalog: () => Effect.Effect<
    IntegrationsShCatalog,
    IntegrationsShError,
    HttpClient.HttpClient
  >
  readonly surface: (
    domain: string,
  ) => Effect.Effect<
    IntegrationsShDomainSurface,
    IntegrationsShError,
    HttpClient.HttpClient
  >
}

export interface IntegrationsShExtensionOptions {
  readonly baseUrl?: string
  readonly catalogUrl?: string
  readonly cacheTtlMs?: number
}

const requestText = Effect.fn('IntegrationsSh.requestText')(function* (
  operation: string,
  url: string,
) {
  const client = yield* HttpClient.HttpClient
  let request = HttpClientRequest.get(url)
  request = HttpClientRequest.setHeader(request, 'accept', 'application/json')
  request = HttpClientRequest.setHeader(
    request,
    'user-agent',
    'garden/executor',
  )

  const response = yield* Effect.mapError(
    client.execute(request),
    (cause) =>
      new IntegrationsShTransportError({
        operation,
        url,
        message: `integrations.sh ${operation} request failed.`,
        cause,
      }),
  )
  if (response.status < 200 || response.status >= 300) {
    return yield* new IntegrationsShHttpError({
      operation,
      url,
      status: response.status,
    })
  }
  return yield* Effect.mapError(
    response.text,
    (cause) =>
      new IntegrationsShTransportError({
        operation,
        url,
        message: `integrations.sh ${operation} response could not be read.`,
        cause,
      }),
  )
})

const decodeJson = Effect.fn('IntegrationsSh.decodeJson')(function* <A, I>(
  operation: string,
  schema: Schema.Decoder<A, I>,
  text: string,
) {
  const jsonSchema = Schema.fromJsonString(schema)
  return yield* Effect.mapError(
    Schema.decodeUnknownEffect(jsonSchema)(text),
    () =>
      new IntegrationsShDecodeError({
        operation,
        message: `integrations.sh returned an invalid ${operation} document.`,
      }),
  )
})

const modelSurfaceDocument = Effect.fn('IntegrationsSh.modelSurface')(
  function* (text: string) {
    const external = yield* decodeJson(
      'surface',
      IntegrationsShExternalSurfaceDocument,
      text,
    )
    return IntegrationsShDomainSurface.make({
      domain: external.domain.toLowerCase(),
      description: external.description,
      summary: external.summary,
      surfaces: external.surfaces.map((surface) =>
        IntegrationsShSurface.make({
          type: surface.type,
          slug: surface.slug,
          name: surface.name,
          endpoint: surface.url,
          spec: surface.spec,
          transports: Option.getOrElse(surface.transports, () => []),
          docs: surface.docs,
        }),
      ),
    })
  },
)

/** Create a strict integrations.sh transport adapter. Effect Cache owns TTL,
 * in-flight deduplication, capacity, and failure eviction. Garden catalog
 * policy is intentionally absent from this module. */
export const createIntegrationsShExtension = (
  options: IntegrationsShExtensionOptions = {},
): IntegrationsShExtension => {
  const baseUrl = options.baseUrl ?? INTEGRATIONS_SH_BASE_URL
  const catalogUrl = options.catalogUrl ?? INTEGRATIONS_SH_CATALOG_URL
  const cacheTtlMs = options.cacheTtlMs ?? 12 * 60 * 60 * 1_000

  const loadCatalog = Effect.fn('IntegrationsSh.loadCatalog')(function* () {
    const text = yield* requestText('catalog', catalogUrl)
    return yield* decodeJson('catalog', IntegrationsShCatalog, text)
  })

  const loadSurface = Effect.fn('IntegrationsSh.loadSurface')(function* (
    domain: string,
  ) {
    const normalized = domain.trim().toLowerCase()
    if (
      normalized.length === 0 ||
      normalized.includes('/') ||
      normalized.includes('\\')
    ) {
      return yield* new IntegrationsShDecodeError({
        operation: 'surface',
        message: 'A valid integrations.sh domain is required.',
      })
    }
    const url = `${baseUrl}/api/${encodeURIComponent(normalized)}/surface`
    const text = yield* requestText('surface', url)
    return yield* modelSurfaceDocument(text)
  })

  const successfulTtl = (exit: Exit.Exit<unknown, unknown>): Duration.Input => {
    if (Exit.isSuccess(exit)) return cacheTtlMs
    return Duration.zero
  }

  const catalogCache = Effect.runSync(
    Cache.makeWith(() => loadCatalog(), {
      capacity: 1,
      timeToLive: successfulTtl,
      requireServicesAt: 'lookup',
    }),
  )
  const surfaceCache = Effect.runSync(
    Cache.makeWith(loadSurface, {
      capacity: 500,
      timeToLive: successfulTtl,
      requireServicesAt: 'lookup',
    }),
  )

  return {
    catalog: Effect.fn('IntegrationsSh.catalog')(function* () {
      return yield* Cache.get(catalogCache, 'catalog')
    }),
    surface: Effect.fn('IntegrationsSh.surface')(function* (domain: string) {
      return yield* Cache.get(surfaceCache, domain.trim().toLowerCase())
    }),
  }
}
