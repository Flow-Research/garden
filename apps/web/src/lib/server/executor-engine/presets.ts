import {
  graphqlPresets,
  type GraphqlPreset,
} from '@executor-js/plugin-graphql/presets'
import {
  mcpPresets,
  type McpPreset,
  type McpRemotePreset,
} from '@executor-js/plugin-mcp/presets'
import { openApiPresets } from '@executor-js/plugin-openapi/presets'
import { googleCatalog } from '@executor-js/plugin-openapi/providers/google'
import { microsoftCatalog } from '@executor-js/plugin-openapi/providers/microsoft'

export type GardenExecutorPresetProtocol = 'openapi' | 'mcp' | 'graphql'

interface GardenExecutorPresetBase {
  readonly protocol: GardenExecutorPresetProtocol
  readonly id: string
  readonly slug: string
  readonly name: string
  readonly summary: string
  readonly url: string
  readonly icon?: string
  readonly featured: boolean
  readonly family?: string
}

export interface GardenOpenApiPreset extends GardenExecutorPresetBase {
  readonly protocol: 'openapi'
  readonly preset: IntegrationPreset
}

export interface GardenMcpPreset extends GardenExecutorPresetBase {
  readonly protocol: 'mcp'
  readonly preset: McpRemotePreset
}

export interface GardenGraphqlPreset extends GardenExecutorPresetBase {
  readonly protocol: 'graphql'
  readonly preset: GraphqlPreset
}

export type GardenExecutorPreset =
  | GardenOpenApiPreset
  | GardenMcpPreset
  | GardenGraphqlPreset

const disabledOpenApiPresetIds = new Set(['github-rest'])
const disabledMcpPresetIds = new Set(['emulate-mcp'])
const disabledGraphqlPresetIds = new Set(['github-graphql'])

const routingCapabilitiesBySlug = new Map<string, readonly string[]>([
  [
    'decide',
    [
      'analyze structured data and datasets',
      'identify trends, correlations, and unusual values',
      'create charts and Excel reports',
    ],
  ],
])

export function executorRoutingCapabilities(slug: string): readonly string[] {
  return routingCapabilitiesBySlug.get(slug) ?? []
}

const isRemoteMcpPreset = (preset: McpPreset): preset is McpRemotePreset =>
  preset.transport !== 'stdio'

export const gardenOpenApiCustomPresets: readonly IntegrationPreset[] = [
  ...googleCatalog,
  ...microsoftCatalog,
]

export const gardenOpenApiPresets: readonly IntegrationPreset[] = [
  ...openApiPresets.filter(
    (preset) => !disabledOpenApiPresetIds.has(preset.id),
  ),
  ...gardenOpenApiCustomPresets,
]

/** Adds Decide to the SDK catalog so users can connect through Executor's MCP
 * OAuth discovery and dynamic registration, rather than manage API keys.
 * Endpoint and OAuth support: https://www.trydecide.ai/docs/mcp and
 * https://chat.trydecide.ai/.well-known/oauth-authorization-server. */
export const gardenMcpPresets: readonly McpRemotePreset[] = [
  ...mcpPresets
    .filter(isRemoteMcpPreset)
    .filter((preset) => !disabledMcpPresetIds.has(preset.id)),
  {
    id: 'decide',
    name: 'Decide',
    summary:
      'Analyze data, build charts and reports, and read generated files. Follow-up analyses reuse the same session. Uses credits from your Decide account.',
    url: 'https://www.trydecide.ai/docs/mcp',
    endpoint: 'https://api.trydecide.ai/mcp',
    featured: true,
  },
]

export const gardenGraphqlPresets: readonly GraphqlPreset[] =
  graphqlPresets.filter((preset) => !disabledGraphqlPresetIds.has(preset.id))

const openApiPresetMetadata = (
  preset: IntegrationPreset,
): readonly GardenOpenApiPreset[] => {
  if (preset.url === undefined) return []
  return [
    {
      protocol: 'openapi',
      id: preset.id,
      slug: preset.defaultSlug ?? preset.id,
      name: preset.name,
      summary: preset.summary,
      url: preset.url,
      ...(preset.icon === undefined ? {} : { icon: preset.icon }),
      featured: preset.featured === true,
      ...(preset.family === undefined ? {} : { family: preset.family }),
      preset,
    },
  ]
}

export const gardenExecutorPresets: readonly GardenExecutorPreset[] = [
  ...gardenOpenApiPresets.flatMap(openApiPresetMetadata),
  ...gardenMcpPresets.map(
    (preset): GardenMcpPreset => ({
      protocol: 'mcp',
      id: preset.id,
      slug: preset.id,
      name: preset.name,
      summary: preset.summary,
      url: preset.endpoint,
      ...(preset.icon === undefined ? {} : { icon: preset.icon }),
      featured: preset.featured === true,
      preset,
    }),
  ),
  ...gardenGraphqlPresets.map(
    (preset): GardenGraphqlPreset => ({
      protocol: 'graphql',
      id: preset.id,
      slug: preset.id,
      name: preset.name,
      summary: preset.summary,
      url: preset.endpoint,
      ...(preset.icon === undefined ? {} : { icon: preset.icon }),
      featured: preset.featured === true,
      preset,
    }),
  ),
]

export const getGardenExecutorPreset = (
  protocol: GardenExecutorPresetProtocol,
  presetId: string,
): GardenExecutorPreset | undefined =>
  gardenExecutorPresets.find(
    (preset) => preset.protocol === protocol && preset.id === presetId,
  )
import type { IntegrationPreset } from '@executor-js/sdk/core'
