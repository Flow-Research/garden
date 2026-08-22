import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Duration, Effect, Option, Result, Schema } from 'effect'
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from 'effect/unstable/http'
import { parse as parseYaml } from 'yaml'
import { extract, introspect } from '@executor-js/plugin-graphql/core'
import { discordNativeTools } from '@garden/connectors/discord/tools'
import { githubNativeTools } from '@garden/connectors/github/tools'
import {
  ExecutorToolPreviewItem,
  ExecutorToolPreviewResponse,
  type ExecutorIntegrationSource,
  type ExecutorToolPreviewItem as ExecutorToolPreviewItemType,
} from '@/lib/executor-contract'
import { logApiFailure } from '@/lib/server/api-logging'
import { catalogCandidateSource, type CatalogProvider } from './catalog'
import { resolveInstallTarget } from './install'
import type { IntegrationsShDomainSurface } from './integrations-sh'
import { getGardenExecutorPreset } from './presets'

const UnknownRecord = Schema.Record(Schema.String, Schema.Unknown)
const decodeUnknownRecord = Schema.decodeUnknownOption(UnknownRecord)

const parsePreviewUrl = (value: string): Option.Option<URL> =>
  Option.fromNullishOr(URL.parse(value))

class ToolPreviewFailure extends Schema.Error<ToolPreviewFailure>(
  'ToolPreviewFailure',
)({ reason: Schema.String }) {}

const previewItem = (
  name: string,
  description: string,
): ExecutorToolPreviewItemType => {
  const plainDescription = description
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return ExecutorToolPreviewItem.make({
    name,
    description:
      plainDescription.length > 280
        ? `${plainDescription.slice(0, 279)}…`
        : plainDescription,
  })
}

const readyPreview = (
  tools: readonly ExecutorToolPreviewItemType[],
): ExecutorToolPreviewResponse =>
  ExecutorToolPreviewResponse.make({
    status: 'ready',
    tools,
    toolCount: Option.some(tools.length),
    message:
      tools.length === 0
        ? 'This source did not publish any tools.'
        : `${tools.length} tools available before installation.`,
  })

const unavailablePreview = (message: string): ExecutorToolPreviewResponse =>
  ExecutorToolPreviewResponse.make({
    status: 'unavailable',
    tools: [],
    toolCount: Option.none(),
    message,
  })

const authenticationRequiredPreview = (
  message: string,
): ExecutorToolPreviewResponse =>
  ExecutorToolPreviewResponse.make({
    status: 'authentication_required',
    tools: [],
    toolCount: Option.none(),
    message,
  })

const definitionMissingPreview = (): ExecutorToolPreviewResponse =>
  ExecutorToolPreviewResponse.make({
    status: 'definition_missing',
    tools: [],
    toolCount: Option.none(),
    message:
      'Garden found API documentation, but no server-owned machine-readable definition is available to install.',
  })

const requestText = Effect.fn('ExecutorToolPreview.requestText')(function* (
  url: string,
) {
  const client = yield* HttpClient.HttpClient
  const request = HttpClientRequest.get(url).pipe(
    HttpClientRequest.setHeader(
      'accept',
      'application/json, application/yaml, text/yaml, */*',
    ),
    HttpClientRequest.setHeader('user-agent', 'garden/executor-preview'),
  )
  const response = yield* Effect.mapError(
    client.execute(request),
    () =>
      new ToolPreviewFailure({ reason: 'Source definition is unreachable.' }),
  )
  if (response.status === 401 || response.status === 403) {
    return yield* new ToolPreviewFailure({ reason: 'authentication_required' })
  }
  if (response.status < 200 || response.status >= 300) {
    return yield* new ToolPreviewFailure({
      reason: `Source definition returned HTTP ${response.status}.`,
    })
  }
  return yield* Effect.mapError(
    response.text,
    () =>
      new ToolPreviewFailure({
        reason: 'Source definition could not be read.',
      }),
  )
})

const openApiTools = Effect.fn('ExecutorToolPreview.openapi')(function* (
  specUrl: string,
) {
  const text = yield* requestText(specUrl)
  const parsed = yield* Effect.try({
    try: () => parseYaml(text),
    catch: () =>
      new ToolPreviewFailure({
        reason: 'OpenAPI definition could not be parsed.',
      }),
  })
  const document = decodeUnknownRecord(parsed)
  if (Option.isNone(document)) {
    return yield* new ToolPreviewFailure({
      reason: 'OpenAPI definition has an invalid document shape.',
    })
  }
  const paths = decodeUnknownRecord(document.value.paths)
  if (Option.isNone(paths)) {
    return yield* new ToolPreviewFailure({
      reason: 'OpenAPI definition does not publish paths.',
    })
  }

  const methods = new Set([
    'get',
    'post',
    'put',
    'patch',
    'delete',
    'head',
    'options',
    'trace',
  ])
  const tools: ExecutorToolPreviewItemType[] = []
  for (const [path, pathValue] of Object.entries(paths.value)) {
    const pathItem = decodeUnknownRecord(pathValue)
    if (Option.isNone(pathItem)) continue
    for (const [method, operationValue] of Object.entries(pathItem.value)) {
      if (!methods.has(method.toLowerCase())) continue
      const operation = decodeUnknownRecord(operationValue)
      if (Option.isNone(operation)) continue
      const operationId = operation.value.operationId
      const summary = operation.value.summary
      const description = operation.value.description
      const name =
        typeof operationId === 'string' && operationId.trim().length > 0
          ? operationId.trim()
          : `${method.toLowerCase()} ${path}`
      let detail = `${method.toUpperCase()} ${path}`
      if (typeof description === 'string' && description.trim().length > 0) {
        detail = description.trim()
      }
      if (typeof summary === 'string' && summary.trim().length > 0) {
        detail = summary.trim()
      }
      tools.push(previewItem(name, detail))
    }
  }
  return readyPreview(tools)
})

const mcpTools = Effect.fn('ExecutorToolPreview.mcp')(function* (
  endpoint: string,
) {
  const endpointUrl = parsePreviewUrl(endpoint)
  if (Option.isNone(endpointUrl)) {
    return yield* new ToolPreviewFailure({
      reason: 'MCP endpoint URL is invalid.',
    })
  }
  const tools = yield* Effect.tryPromise({
    try: async () => {
      const client = new Client({
        name: 'garden-tool-preview',
        version: '1.0.0',
      })
      const transport = new StreamableHTTPClientTransport(endpointUrl.value)
      try {
        await client.connect(transport)
        const discovered: ExecutorToolPreviewItemType[] = []
        let cursor: string | undefined
        do {
          const page = await client.listTools(
            cursor === undefined ? undefined : { cursor },
          )
          for (const tool of page.tools) {
            discovered.push(previewItem(tool.name, tool.description ?? ''))
          }
          cursor = page.nextCursor
        } while (cursor !== undefined && cursor.length > 0)
        return discovered
      } finally {
        await client.close().catch(() => undefined)
      }
    },
    catch: (cause) =>
      new ToolPreviewFailure({
        reason: cause instanceof Error ? cause.message : 'MCP preview failed.',
      }),
  })
  return readyPreview(tools)
})

const graphqlTools = Effect.fn('ExecutorToolPreview.graphql')(function* (
  endpoint: string,
) {
  const introspection = yield* introspect(endpoint)
  const extraction = yield* extract(introspection)
  return readyPreview(
    extraction.result.fields.map((field) =>
      previewItem(
        field.fieldName,
        Option.getOrElse(
          field.description,
          () => `${field.kind} ${field.fieldName}`,
        ),
      ),
    ),
  )
})

const previewTarget = Effect.fn('ExecutorToolPreview.target')(function* (
  target: ReturnType<typeof resolveInstallTarget> extends Option.Option<infer A>
    ? A
    : never,
) {
  if (target.kind === 'mcp') {
    return yield* mcpTools(target.endpoint).pipe(
      Effect.timeoutOrElse({
        duration: Duration.seconds(15),
        orElse: () =>
          Effect.fail(
            new ToolPreviewFailure({ reason: 'MCP preview timed out.' }),
          ),
      }),
    )
  }
  if (target.kind === 'openapi') {
    return yield* openApiTools(target.spec).pipe(
      Effect.provide(FetchHttpClient.layer),
    )
  }

  const preset = getGardenExecutorPreset(target.protocol, target.presetId)
  if (preset === undefined) {
    return yield* new ToolPreviewFailure({
      reason: 'Server-owned source preset is unavailable.',
    })
  }
  if (preset.protocol === 'openapi') {
    if (preset.preset.url === undefined) {
      return yield* new ToolPreviewFailure({
        reason: 'OpenAPI source has no definition URL.',
      })
    }
    return yield* openApiTools(preset.preset.url).pipe(
      Effect.provide(FetchHttpClient.layer),
    )
  }
  if (preset.protocol === 'graphql') {
    return yield* graphqlTools(preset.preset.endpoint).pipe(
      Effect.provide(FetchHttpClient.layer),
    )
  }
  return yield* new ToolPreviewFailure({
    reason: 'This source cannot be previewed.',
  })
})

const failurePreview = (failure: unknown): ExecutorToolPreviewResponse => {
  const message = failure instanceof Error ? failure.message : String(failure)
  const normalized = message.toLowerCase()
  if (
    normalized.includes('401') ||
    normalized.includes('403') ||
    normalized.includes('oauth') ||
    normalized.includes('unauthorized') ||
    normalized.includes('authentication_required')
  ) {
    return authenticationRequiredPreview(
      'This provider requires authentication before it publishes tool names.',
    )
  }
  return unavailablePreview('Garden could not preview this source right now.')
}

export const previewProviderTools = Effect.fn('ExecutorToolPreview.provider')(
  function* (
    provider: CatalogProvider,
    surface: IntegrationsShDomainSurface,
    source: ExecutorIntegrationSource,
  ) {
    if (source === 'native') {
      if (String(provider.providerId) === 'github.com') {
        return readyPreview(
          githubNativeTools.map((tool) =>
            previewItem(tool.name, tool.description),
          ),
        )
      }
      if (String(provider.providerId) === 'discord.com') {
        return readyPreview(
          discordNativeTools.map((tool) =>
            previewItem(tool.name, tool.description),
          ),
        )
      }
    }

    const candidates = provider.candidates.filter(
      (candidate) => catalogCandidateSource(candidate) === source,
    )
    let deferredFailure: ExecutorToolPreviewResponse | undefined
    for (const candidate of candidates) {
      const target = resolveInstallTarget(candidate, surface)
      if (Option.isNone(target)) continue
      const result = yield* Effect.result(previewTarget(target.value))
      if (Result.isSuccess(result)) return result.success
      logApiFailure({
        event: 'executor.preview.target_degraded',
        fields: { source, targetKind: target.value.kind },
        error: result.failure,
        level: 'warn',
      })
      const preview =
        source === 'mcp'
          ? authenticationRequiredPreview(
              'Authenticate after installation to load this MCP server’s tool names.',
            )
          : failurePreview(result.failure)
      if (preview.status === 'authentication_required') return preview
      deferredFailure = preview
    }
    return deferredFailure ?? definitionMissingPreview()
  },
)
