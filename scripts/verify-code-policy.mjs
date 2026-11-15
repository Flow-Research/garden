import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseSync } from 'oxc-parser'

/**
 * Ratchet for Garden code rules that oxlint cannot express.
 *
 * Counts `try/catch`, `useEffect`, and type-escape casts (`as any`,
 * `as unknown as T`) per file and compares the counts to
 * `scripts/code-policy-baseline.json`. CI fails when a file gains a
 * violation, and also when a file drops below its baseline, so the
 * baseline only ever shrinks. Run `pnpm verify:code-policy --update`
 * after removing violations.
 */

const roots = ['apps', 'packages', 'workers']
const skipDirs = new Set([
  'node_modules',
  'dist',
  '.output',
  '.tanstack',
  '.turbo',
  '.wrangler',
])
const baselinePath = path.resolve('scripts/code-policy-baseline.json')

const rules = {
  'try-catch':
    'Use Result.try / Result.tryPromise from better-result instead of try/catch.',
  'use-effect':
    'useEffect is banned. Use a loader, server function, event handler, subscription, or derived state.',
  'type-escape':
    'Do not escape the type system with `as any` or `as unknown as T`. Validate with Zod at the boundary or fix the type.',
}

function listSources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory())
      return skipDirs.has(entry.name) ? [] : listSources(full)
    const isSource =
      /\.(ts|tsx|mts|cts)$/.test(entry.name) && !entry.name.endsWith('.d.ts')
    return isSource && !entry.name.endsWith('.gen.ts') ? [full] : []
  })
}

const escapeTypes = new Set(['TSAnyKeyword', 'TSUnknownKeyword'])

function countViolations(file) {
  const { program } = parseSync(file, readFileSync(file, 'utf8'))
  const counts = { 'try-catch': 0, 'use-effect': 0, 'type-escape': 0 }
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit)
    if (!node || typeof node.type !== 'string') return
    if (node.type === 'TryStatement' && node.handler) counts['try-catch'] += 1
    if (node.type === 'ImportSpecifier' && node.imported.name === 'useEffect') {
      counts['use-effect'] += 1
    }
    if (
      node.type === 'MemberExpression' &&
      node.property.name === 'useEffect'
    ) {
      counts['use-effect'] += 1
    }
    if (node.type === 'TSAsExpression') {
      const doubleCast =
        node.expression.type === 'TSAsExpression' &&
        escapeTypes.has(node.expression.typeAnnotation.type)
      if (node.typeAnnotation.type === 'TSAnyKeyword' || doubleCast)
        counts['type-escape'] += 1
    }
    for (const [key, value] of Object.entries(node)) {
      if (key !== 'parent' && value && typeof value === 'object') visit(value)
    }
  }
  visit(program)
  return counts
}

function measure() {
  const current = Object.fromEntries(
    Object.keys(rules).map((rule) => [rule, {}]),
  )
  for (const file of roots.flatMap(listSources).sort()) {
    const relative = file.split(path.sep).join('/')
    for (const [rule, count] of Object.entries(countViolations(file))) {
      if (count > 0) current[rule][relative] = count
    }
  }
  return current
}

const current = measure()

if (process.argv.includes('--update')) {
  writeFileSync(baselinePath, `${JSON.stringify(current, null, 2)}\n`)
  for (const rule of Object.keys(rules)) {
    const total = Object.values(current[rule]).reduce((sum, n) => sum + n, 0)
    process.stdout.write(`${rule}: ${total}\n`)
  }
  process.exit(0)
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
const added = []
const stale = []
for (const [rule, message] of Object.entries(rules)) {
  const files = new Set([
    ...Object.keys(current[rule]),
    ...Object.keys(baseline[rule] ?? {}),
  ])
  for (const file of files) {
    const now = current[rule][file] ?? 0
    const allowed = baseline[rule]?.[file] ?? 0
    if (now > allowed)
      added.push(`${file}: ${rule} ${allowed} -> ${now}. ${message}`)
    if (now < allowed) stale.push(`${file}: ${rule} ${allowed} -> ${now}`)
  }
}

if (added.length > 0) {
  console.error(
    `New code-policy violations:\n${added.map((line) => `  ${line}`).join('\n')}`,
  )
}
if (stale.length > 0) {
  console.error(
    `Violations removed; lock in the lower baseline with \`pnpm verify:code-policy --update\`:\n${stale.map((line) => `  ${line}`).join('\n')}`,
  )
}
if (added.length > 0 || stale.length > 0) process.exit(1)
process.stdout.write('Code policy baseline holds.\n')
