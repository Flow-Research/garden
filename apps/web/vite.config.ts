import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  createLogger,
  defineConfig,
  esmExternalRequirePlugin,
  loadEnv,
  type Logger,
  type LogOptions,
  type Plugin,
} from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import posthogRollupPlugin from '@posthog/rollup-plugin'
import agents from 'agents/vite'

const legacyEnvFiles = [
  fileURLToPath(new URL('./.env', import.meta.url)),
  fileURLToPath(new URL('./.dev.vars', import.meta.url)),
]
for (const path of legacyEnvFiles) {
  if (existsSync(path)) {
    throw new Error(`Move ${path} to the repository-root .env file.`)
  }
}

const rootDir = fileURLToPath(new URL('../..', import.meta.url))
const executorSource = (path: string) =>
  fileURLToPath(new URL(`../../third_party/executor/${path}`, import.meta.url))
const executorSourceAliases = [
  {
    find: /^@executor-js\/host-mcp\/(browser-approval|seams|tool-server)$/,
    replacement: `${executorSource('packages/hosts/mcp/src')}/$1.ts`,
  },
  {
    find: /^@executor-js\/cloudflare\/mcp\/agent-durable-object$/,
    replacement: executorSource(
      'packages/hosts/cloudflare/src/mcp/agent-session-durable-object.ts',
    ),
  },
  {
    find: /^@executor-js\/cloudflare\/mcp\/(execution-owner-directory|session-stub)$/,
    replacement: `${executorSource('packages/hosts/cloudflare/src/mcp')}/$1.ts`,
  },
  {
    find: /^@executor-js\/runtime-dynamic-worker$/,
    replacement: executorSource(
      'packages/kernel/runtime-dynamic-worker/src/index.ts',
    ),
  },
  {
    find: /^@executor-js\/plugin-encrypted-secrets$/,
    replacement: executorSource(
      'packages/plugins/encrypted-secrets/src/index.ts',
    ),
  },
  {
    find: /^@executor-js\/plugin-openapi\/presets$/,
    replacement: executorSource('packages/plugins/openapi/src/sdk/presets.ts'),
  },
  {
    find: /^@executor-js\/plugin-mcp\/presets$/,
    replacement: executorSource('packages/plugins/mcp/src/sdk/presets.ts'),
  },
  {
    find: /^@executor-js\/plugin-graphql\/presets$/,
    replacement: executorSource('packages/plugins/graphql/src/sdk/presets.ts'),
  },
  {
    find: /^@executor-js\/plugin-toolkits\/server$/,
    replacement: executorSource('packages/plugins/toolkits/src/server.ts'),
  },
]
const ssrDependencyStubs = new Map([
  [
    'shiki',
    fileURLToPath(new URL('./src/lib/build/ssr-shiki.ts', import.meta.url)),
  ],
  [
    '@streamdown/code',
    fileURLToPath(
      new URL('./src/lib/build/ssr-streamdown-code.ts', import.meta.url),
    ),
  ],
  [
    '@streamdown/mermaid',
    fileURLToPath(
      new URL('./src/lib/build/ssr-streamdown-mermaid.ts', import.meta.url),
    ),
  ],
])
const workerNodeBuiltins = [
  'buffer',
  'child_process',
  'crypto',
  'dns',
  'events',
  'fs',
  'fs/promises',
  'net',
  'os',
  'path',
  'stream',
  'string_decoder',
  'tls',
  'url',
  'util',
] as const
const workerNodeBuiltinPaths = Object.fromEntries(
  workerNodeBuiltins.map((specifier) => [specifier, `node:${specifier}`]),
)
const rootEnv = loadEnv(process.env.NODE_ENV ?? 'development', rootDir, '')
for (const [key, value] of Object.entries(rootEnv)) {
  process.env[key] ??= value
}

const enableDevtools =
  process.env.ENABLE_DEVTOOLS === '1' ||
  process.env.VITE_ENABLE_DEVTOOLS === '1'
const cloudflareConfigPath =
  process.env.CLOUDFLARE_WORKER_CONFIG_PATH || undefined
const remoteBindings = process.env.CLOUDFLARE_VITE_REMOTE_BINDINGS !== '0'
const postHogSourcemapApiKey = process.env.POSTHOG_CLI_API_KEY
const postHogSourcemapProjectId = process.env.POSTHOG_CLI_PROJECT_ID
const postHogSourcemapHost = process.env.POSTHOG_HOST
const postHogReleaseVersion =
  process.env.POSTHOG_RELEASE_VERSION ??
  process.env.WORKERS_CI_COMMIT_SHA ??
  process.env.CF_PAGES_COMMIT_SHA ??
  process.env.GITHUB_SHA
const requirePostHogSourcemaps = process.env.GARDEN_REQUIRE_POSTHOG === '1'
const baseLogger = createLogger()

function isSandboxInfoLog(message: unknown) {
  if (typeof message === 'string') {
    return (
      message.includes("component: 'sandbox-do'") ||
      message.includes('"component":"sandbox-do"') ||
      message.includes('"component": "sandbox-do"')
    )
  }

  if (message && typeof message === 'object') {
    return (message as { component?: unknown }).component === 'sandbox-do'
  }

  return false
}

const logger: Logger = {
  ...baseLogger,
  info(message: string, options?: LogOptions) {
    if (isSandboxInfoLog(message)) {
      if (process.env.DEBUG_SANDBOX_LOGS === '1') {
        console.debug(message)
      }
      return
    }

    baseLogger.info(message, options)
  },
}

/**
 * Browser-only document renderers carry hundreds of lazy language, theme, and
 * diagram modules. During SSR they render plaintext placeholders, so resolve
 * those dependencies to equivalent lightweight seams in the Worker build.
 */
function ssrDependencyStubsPlugin(): Plugin {
  return {
    enforce: 'pre',
    name: 'garden-ssr-dependency-stubs',
    resolveId: {
      filter: {
        id: /^(?:shiki|@streamdown\/code|@streamdown\/mermaid)$/,
      },
      handler(source) {
        if (this.environment.name !== 'ssr') {
          return null
        }

        return ssrDependencyStubs.get(source) ?? null
      },
    },
  }
}

/**
 * Adds PostHog's Rollup source-map uploader for production builds. Alchemy sets
 * `GARDEN_REQUIRE_POSTHOG=1` for deploy builds because PostHog is required in
 * Garden production. Local ad hoc builds must not upload just because `.env`
 * contains PostHog credentials, so the explicit flag is the only opt-in. The
 * guard also avoids the plugin-utils resolver's generic missing-key throw and
 * gives CI a clearer action item. References: PostHog Vite source-map upload
 * docs and installed `@posthog/plugin-utils` config resolver.
 */
function postHogSourcemapPlugins() {
  if (!requirePostHogSourcemaps) {
    return []
  }

  if (!postHogSourcemapApiKey || !postHogSourcemapProjectId) {
    throw new Error(
      'Missing POSTHOG_CLI_API_KEY or POSTHOG_CLI_PROJECT_ID for required PostHog source-map upload.',
    )
  }

  return [
    posthogRollupPlugin({
      personalApiKey: postHogSourcemapApiKey,
      projectId: postHogSourcemapProjectId,
      host: postHogSourcemapHost,
      sourcemaps: {
        releaseName: 'garden-web',
        releaseVersion: postHogReleaseVersion,
        batchSize: 100,
        deleteAfterUpload: true,
      },
    }),
  ]
}

const config = defineConfig({
  clearScreen: false,
  envDir: rootDir,
  customLogger: logger,
  server: {
    port: Number(process.env.PORT ?? 3000),
    allowedHosts: ['.ngrok-free.app'],
  },
  resolve: {
    alias: executorSourceAliases,
    tsconfigPaths: true,
    dedupe: ['effect', 'react', 'react-dom'],
  },
  ssr: {
    noExternal: [/^@executor-js\//],
  },
  optimizeDeps: {
    exclude: ['shiki'],
  },
  environments: {
    ssr: {
      build: {
        rolldownOptions: {
          // Cloudflare exposes Node compatibility through ESM `node:` imports,
          // while bundled CommonJS dependencies such as pg still call require.
          // Rolldown's built-in bridge rewrites those external require calls and
          // the path map emits the Worker-compatible specifiers.
          plugins: [
            esmExternalRequirePlugin({
              external: [...workerNodeBuiltins],
            }),
          ],
          output: {
            paths: workerNodeBuiltinPaths,
          },
        },
      },
      optimizeDeps: {
        include: [
          'react',
          'react/jsx-runtime',
          'react/jsx-dev-runtime',
          'react-dom',
          'react-dom/server',
          '@tanstack/react-router > @tanstack/react-store',
        ],
      },
    },
  },
  plugins: [
    ...(enableDevtools ? [devtools()] : []),
    ssrDependencyStubsPlugin(),
    cloudflare({
      viteEnvironment: { name: 'ssr' },
      configPath: cloudflareConfigPath,
      remoteBindings,
      persistState: {
        path:
          process.env.GARDEN_WRANGLER_STATE_PATH ??
          '../../../.garden-wrangler-state',
      },
    }),
    agents(),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
    ...postHogSourcemapPlugins(),
  ],
})

export default config
