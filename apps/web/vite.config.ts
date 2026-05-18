import { createLogger, defineConfig, type Logger, type LogOptions } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import agents from 'agents/vite'

const enableDevtools =
  process.env.ENABLE_DEVTOOLS === '1' ||
  process.env.VITE_ENABLE_DEVTOOLS === '1'
const cloudflareConfigPath =
  process.env.CLOUDFLARE_WORKER_CONFIG_PATH || undefined
const remoteBindings = process.env.CLOUDFLARE_VITE_REMOTE_BINDINGS !== '0'
const enableMcpAuxiliaryWorker =
  process.env.GARDEN_ENABLE_MCP_AUXILIARY_WORKER === '1'
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

const config = defineConfig({
  clearScreen: false,
  customLogger: logger,
  server: {
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
  ],
})

export default config
