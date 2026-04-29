import { defineConfig } from 'vite'
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

const config = defineConfig({
  clearScreen: false,
  resolve: {
    tsconfigPaths: true,
    dedupe: ['react', 'react-dom'],
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
  ],
})

export default config
