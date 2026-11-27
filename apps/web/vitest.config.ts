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
    alias: [
      {
        find: 'tanstack-start-manifest:v',
        replacement: fileURLToPath(
          new URL('./src/test/start-security/manifest.ts', import.meta.url),
        ),
      },
      {
        find: '#tanstack-router-entry',
        replacement: fileURLToPath(
          new URL('./src/test/start-security/router.ts', import.meta.url),
        ),
      },
      {
        find: '#tanstack-start-entry',
        replacement: fileURLToPath(new URL('./src/start.ts', import.meta.url)),
      },
      {
        find: '#tanstack-start-server-fn-resolver',
        replacement: fileURLToPath(
          new URL('./src/test/start-security/resolver.ts', import.meta.url),
        ),
      },
      {
        find: 'cloudflare:workers',
        replacement: fileURLToPath(
          new URL('./src/test/cloudflare-workers-mock.ts', import.meta.url),
        ),
      },
      {
        find: /^@executor-js\/host-mcp\/(browser-approval|seams|tool-server)$/,
        replacement: fileURLToPath(
          new URL(
            '../../third_party/executor/packages/hosts/mcp/src',
            import.meta.url,
          ),
        ).concat('/$1.ts'),
      },
    ],
  },
  plugins: [viteReact()],
  test: {
    server: {
      deps: { inline: [/@tanstack\/(react-start|start-server-core)/] },
    },
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    css: false,
    // Large development hosts otherwise start enough jsdom forks to starve
    // Vitest's worker handshake and report unrelated suite timeouts.
    maxWorkers: 4,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
})
