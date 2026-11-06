import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
      reportOnFailure: true,
    },
    include: ['**/*.test.{ts,tsx}'],
    fileParallelism: false,
    testTimeout: 120_000,
  },
})
