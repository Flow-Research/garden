import { defineConfig, normalizePath, type Plugin } from 'vite'
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

function fullReloadWorkspaceSources(): Plugin {
  const appRoot = normalizePath(new URL('.', import.meta.url).pathname)
  const workspaceRoot = normalizePath(new URL('../..', import.meta.url).pathname)
  const sourceExtensions = /\.(c|m)?(j|t)sx?$|\.css$/
  const watchedSourceRoots = [
    `${appRoot}src/`,
    `${workspaceRoot}/packages/`,
    `${workspaceRoot}/connectors/`,
  ]

  return {
    name: 'garden:full-reload-workspace-sources',
    apply: 'serve',
    handleHotUpdate(ctx) {
      const file = normalizePath(ctx.file)
      if (
        !sourceExtensions.test(file) ||
        !watchedSourceRoots.some((root) => file.startsWith(root))
      ) {
        return
      }

      ctx.server.ws.send({ type: 'full-reload', path: '*' })
      return []
    },
  }
}

const config = defineConfig({
  clearScreen: false,
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
    fullReloadWorkspaceSources(),
  ],
})

export default config
