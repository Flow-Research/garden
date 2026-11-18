import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Container setup exceeded Vitest's 10s default. Match @garden/db's 120s
    // allowance for image pulls, Testcontainers' 60s startup wait, and migrations.
    hookTimeout: 120_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
      reportOnFailure: true,
    },
  },
})
