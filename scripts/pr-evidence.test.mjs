import assert from 'node:assert/strict'
import { test } from 'node:test'
import { evidenceFailures } from './pr-evidence.mjs'

const ui = 'apps/web/src/features/skills/components/skills-page.tsx'
const shot = (name) => `docs/assets/pr/389/${name}`
const check = (files, body = '', verification = 'PASS') =>
  evidenceFailures({ files, body, prNumber: 389, verification })

test('PR #389 as submitted fails: PNGs outside the PR folder', () => {
  const failures = check(
    [ui, 'docs/assets/skills-responsive/mobile-after.png'],
    '![Mobile after](https://raw.githubusercontent.com/x/mobile-after.png)',
  )
  assert.equal(failures.length, 1)
  assert.match(failures[0], /must be WebP in docs\/assets\/pr\/389\//)
})

test('UI change with WebP screenshots in the PR folder passes', () => {
  assert.deepEqual(check([ui, shot('mobile-after.webp')]), [])
})

test('PNG inside the PR folder still fails', () => {
  assert.equal(check([ui, shot('mobile-after.png')]).length, 1)
})

test('UI change without screenshots fails', () => {
  assert.match(check([ui])[0], /UI changes need screenshots/)
})

test('UI change with an image in the description passes', () => {
  assert.deepEqual(check([ui], '![after](https://example.com/a.webp)'), [])
})

test('INCONCLUSIVE verification is the stated way out', () => {
  assert.deepEqual(check([ui], '', 'INCONCLUSIVE: no browser host'), [])
})

test('API routes, tests, and non-UI code need no screenshots', () => {
  assert.deepEqual(
    check([
      'apps/web/src/routes/api/issues/$id.ts',
      'apps/web/src/features/skills/components/skills-page.test.tsx',
      'packages/agent-runtime/src/agent-do.ts',
    ]),
    [],
  )
})

test('product images are allowed anywhere they already live', () => {
  assert.deepEqual(
    check(['apps/web/public/logo512.png', 'docs/assets/readme/agents.webp']),
    [],
  )
})
