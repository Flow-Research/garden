import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * Codemode 0.4 moved execute-tool persistence into a Worker facet resolved from
 * `ctx.exports`. TypeScript and Vite both succeed when that runtime export is
 * absent, so inspect the final Worker artifact and fail the build before deploy.
 * Reference: installed `@cloudflare/codemode/docs/vite-plugin.md`.
 */
const workerBundle = readFileSync(
  new URL('../dist/server/index.js', import.meta.url),
  'utf8',
)

assert.equal(
  /export\s*\{[^}]*\bCodemodeRuntime\b[^}]*\}/s.test(workerBundle),
  true,
  'Worker bundle must export CodemodeRuntime for createExecuteTool()',
)

console.log('worker entry passed: CodemodeRuntime is exported')
