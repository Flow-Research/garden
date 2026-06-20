import { createLogger, defineConfig, type Logger, type LogOptions } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import posthogRollupPlugin from '@posthog/rollup-plugin'
import agents from 'agents/vite'

const enableDevtools =
  process.env.ENABLE_DEVTOOLS === '1' ||
  process.env.VITE_ENABLE_DEVTOOLS === '1'
const cloudflareConfigPath =
  process.env.CLOUDFLARE_WORKER_CONFIG_PATH || undefined
const remoteBindings = process.env.CLOUDFLARE_VITE_REMOTE_BINDINGS !== '0'
const enableMcpAuxiliaryWorker =
  process.env.GARDEN_ENABLE_MCP_AUXILIARY_WORKER === '1'
const postHogSourcemapApiKey = process.env.POSTHOG_API_KEY
const postHogSourcemapProjectId = process.env.POSTHOG_PROJECT_ID
const postHogSourcemapHost = process.env.POSTHOG_HOST
const postHogReleaseVersion =
  process.env.POSTHOG_RELEASE_VERSION ??
  process.env.CF_PAGES_COMMIT_SHA ??
  process.env.GITHUB_SHA
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
 * Enables PostHog source-map upload only in CI environments that provide the
 * required upload credentials. PostHog's Vite docs require the Rollup plugin for
 * production stack trace de-minification, but its config resolver throws when
 * sourcemaps are enabled without `personalApiKey` or `projectId`. Before this
 * gate, adding the plugin directly would break normal CI/typecheck builds that
 * do not expose secrets; after it, source maps upload only when explicitly
 * configured. References: PostHog Vite source-map upload docs and installed
 * `@posthog/plugin-utils` config resolver.
 */
function postHogSourcemapPlugins() {
  if (!postHogSourcemapApiKey || !postHogSourcemapProjectId) return []

  return [
    posthogRollupPlugin({
      personalApiKey: postHogSourcemapApiKey,
      projectId: postHogSourcemapProjectId,
      host: postHogSourcemapHost,
      sourcemaps: {
        releaseName: 'garden-web',
        releaseVersion: postHogReleaseVersion,
        deleteAfterUpload: true,
      },
    }),
  ]
}

const config = defineConfig({
  clearScreen: false,
  customLogger: logger,
  server: {
    port: Number(process.env.PORT ?? 3000),
    allowedHosts: ['.ngrok-free.app'],
  },
  resolve: {
    tsconfigPaths: true,
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    exclude: ['shiki'],
  },
  environments: {
    ssr: {
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
    cloudflare({
      viteEnvironment: { name: 'ssr' },
      configPath: cloudflareConfigPath,
      ...(enableMcpAuxiliaryWorker
        ? {
            auxiliaryWorkers: [
              { configPath: '../../workers/mcp-proxy/wrangler.jsonc' },
            ],
          }
        : {}),
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
