import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
  define: { __CHUNKS__: JSON.stringify(Number(process.env.CHUNKS ?? 5000)) },
  test: { testTimeout: 300_000, disableConsoleIntercept: true },
})
