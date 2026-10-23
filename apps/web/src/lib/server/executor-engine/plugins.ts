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
import { directDecideMcpPlugin } from './direct-decide-mcp'

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
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    }),
    directDecideMcpPlugin(),
    graphqlPlugin(),
    toolkitsPlugin({ activeToolkitSlug: options.activeToolkitSlug }),
    encryptedSecretsPlugin({ key: secretKey }),
  ] as const

export type GardenExecutorPlugins = ReturnType<typeof makeExecutorPlugins>
