import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Testcontainers spins up Postgres + Neon proxy per suite; allow time for
    // image pulls on first run and for clean shutdown afterwards.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
})
