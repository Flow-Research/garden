import { Schema } from 'effect'
import {
  ExecutorInstallRequest,
  ExecutorInstallResponse,
  ExecutorRegistrySearchResponse,
  ExecutorToolPreviewRequest,
  ExecutorToolPreviewResponse,
  type ExecutorConnectionOwner,
  type ExecutorInstallResponse as ExecutorInstallResponseType,
  type ExecutorIntegrationSource,
  type ExecutorRegistryEntry,
  type ExecutorRegistrySearchResponse as ExecutorRegistrySearchResponseType,
  type ExecutorToolPreviewResponse as ExecutorToolPreviewResponseType,
} from '@/lib/executor-contract'
import { getApiTransport } from './state'

export type RegistryEntry = ExecutorRegistryEntry
export type RegistrySearchResponse = ExecutorRegistrySearchResponseType
export type ToolPreviewResponse = ExecutorToolPreviewResponseType

/** Search the server-owned provider catalog and decode its shared schema. */
export async function searchRegistry(options: {
  q?: string
  category?: string
  limit?: number
  offset?: number
  featured?: boolean
}): Promise<RegistrySearchResponse> {
  const search = new URLSearchParams()
  if (options.q) search.set('q', options.q)
  if (options.category) search.set('category', options.category)
  if (options.limit) search.set('limit', String(options.limit))
  if (options.offset) search.set('offset', String(options.offset))
  if (options.featured) search.set('featured', '1')
  let suffix = ''
  if (search.size > 0) suffix = `?${search}`

  const response = await getApiTransport().request<unknown>(
    `/api/executor/registry${suffix}`,
  )
  return Schema.decodeUnknownPromise(ExecutorRegistrySearchResponse)(response)
}

/** Install only the selected provider identity. Endpoints, specs, slugs, and
 * candidate precedence remain server-owned catalog policy. */
export async function connectIntegration(input: {
  readonly entry: RegistryEntry
  readonly source: ExecutorIntegrationSource
}): Promise<ExecutorInstallResponseType> {
  const request = ExecutorInstallRequest.make({
    providerId: input.entry.providerId,
    source: input.source,
  })
  const response = await getApiTransport().request<unknown>(
    '/api/executor/install',
    {
      method: 'POST',
      body: JSON.stringify(Schema.encodeSync(ExecutorInstallRequest)(request)),
    },
  )
  return Schema.decodeUnknownPromise(ExecutorInstallResponse)(response)
}

export async function previewIntegrationTools(input: {
  readonly entry: RegistryEntry
  readonly source: ExecutorIntegrationSource
}): Promise<ToolPreviewResponse> {
  const request = ExecutorToolPreviewRequest.make({
    providerId: input.entry.providerId,
    source: input.source,
  })
  const response = await getApiTransport().request<unknown>(
    '/api/executor/preview',
    {
      method: 'POST',
      body: JSON.stringify(
        Schema.encodeSync(ExecutorToolPreviewRequest)(request),
      ),
    },
  )
  return Schema.decodeUnknownPromise(ExecutorToolPreviewResponse)(response)
}

export function executorOAuthStartUrl(
  integration: string,
  owner: ExecutorConnectionOwner,
): string {
  const search = new URLSearchParams({ integration, owner })
  return `/api/executor/oauth/start?${search}`
}

export function createExecutorConnection(input: {
  integration: string
  name: string
  owner: ExecutorConnectionOwner
  template: string
  values: Record<string, string>
}): Promise<{ ok: true; connection: string }> {
  return getApiTransport().request(
    `/api/connections/${encodeURIComponent(input.integration)}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        name: input.name,
        owner: input.owner,
        template: input.template,
        values: input.values,
      }),
    },
  )
}
