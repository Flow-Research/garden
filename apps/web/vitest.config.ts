import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import viteReact from '@vitejs/plugin-react'

// We intentionally skip the Cloudflare and TanStack Start plugins from
// vite.config.ts here — they inject `resolve.external` for node built-ins,
// which is incompatible with vitest's env resolution. Tests only need React
// + tsconfig-paths to load the components under jsdom.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      'cloudflare:workers': fileURLToPath(
        new URL('./src/test/cloudflare-workers-mock.ts', import.meta.url),
      ),
    },
  },
  plugins: [viteReact()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    css: false,
  },
})
