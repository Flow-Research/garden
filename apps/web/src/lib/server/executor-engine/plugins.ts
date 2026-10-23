import { graphqlPlugin } from '@executor-js/plugin-graphql/core'
import { mcpPlugin } from '@executor-js/plugin-mcp/core'
import { openApiPlugin } from '@executor-js/plugin-openapi/core'
import {
  googleCatalog,
  googleDiscoveryAdapter,
} from '@executor-js/plugin-openapi/providers/google'
import {
  microsoftCatalog,
  microsoftGraphAdapter,
} from '@executor-js/plugin-openapi/providers/microsoft'
import { encryptedSecretsPlugin } from '@executor-js/plugin-encrypted-secrets'
import { toolkitsPlugin } from '@executor-js/plugin-toolkits/server'
import { createGardenLogger } from '@garden/observability/logger'
import { directDecideMcpPlugin } from './direct-decide-mcp'

type PublicMcpProgress = {
  readonly progress?: number
  readonly total?: number
  readonly message?: string
}

const executorMcpLogger = createGardenLogger({
  service: 'garden-staging',
  component: 'executor-mcp-progress',
})

/**
 * Records Decide's public MCP progress without logging code, prompts, tokens,
 * or generated content. The MCP SDK supplies this callback while the remote
 * server is still running, so the lifecycle log can distinguish active work
 * from a silent transport timeout.
 */
export function logPublicMcpProgress(progress: PublicMcpProgress) {
  executorMcpLogger.info('mcp.integration.progress', {
    ...(typeof progress.progress === 'number'
      ? { progress: progress.progress }
      : {}),
    ...(typeof progress.total === 'number' ? { total: progress.total } : {}),
    ...(typeof progress.message === 'string' && progress.message.trim()
      ? { progressMessage: progress.message.trim() }
      : {}),
  })
}

export const makeExecutorPlugins = (
  secretKey: string,
  options: {
    readonly activeToolkitSlug?: string
    readonly fetch?: typeof globalThis.fetch
  } = {},
) =>
  [
    openApiPlugin({
      presets: [...googleCatalog, ...microsoftCatalog],
      specFormats: [googleDiscoveryAdapter, microsoftGraphAdapter],
    }),
    mcpPlugin({
      dangerouslyAllowStdioMCP: false,
      onProgress: logPublicMcpProgress,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    }),
    directDecideMcpPlugin(),
    graphqlPlugin(),
    toolkitsPlugin({ activeToolkitSlug: options.activeToolkitSlug }),
    encryptedSecretsPlugin({ key: secretKey }),
  ] as const

export type GardenExecutorPlugins = ReturnType<typeof makeExecutorPlugins>
