import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

/**
 * Checks that `docs/` stays true to the repository it describes.
 *
 * The handbook at `/handbook` renders `docs/` on every deploy, so a stale
 * path or a broken link ships straight to readers. This script fails CI when:
 *
 * - a site page lacks the required frontmatter or uses an unknown `status`;
 * - a `current` page was last reviewed more than 90 days ago;
 * - a relative link points at a file that does not exist;
 * - a backticked repository path (`apps/...`, `packages/...`) does not exist;
 * - a `meta.json` sidebar entry names a page or folder that does not exist;
 * - an unquoted frontmatter value contains `: `, which YAML rejects;
 * - a code fence names a language the handbook's highlighter does not load.
 *
 * `archive/` pages are historical snapshots, so their links and paths are not
 * checked. Run with `pnpm verify:docs`.
 */

const docsRoot = path.resolve('docs')
const siteFolders = ['tutorials', 'guides', 'concepts', 'reference', 'decisions', 'proposals', 'archive']
const statuses = new Set(['current', 'proposal', 'decision', 'archived'])
const requiredFields = ['title', 'description', 'status', 'owner', 'last_reviewed']
const maxReviewAgeDays = 90
const repoPathPattern = /`((?:apps|packages|scripts|docs|\.github|\.agents|workers)\/[^`\s]*)`/g
const linkPattern = /\]\(([^)\s]+)\)/g
const fencePattern = /^```([A-Za-z0-9_+-]+)/gm
// Shiki languages used across docs/. Add one here only after checking that
// Shiki bundles it; an unknown language fails the handbook build.
const fenceLanguages = new Set(['bash', 'sh', 'shell', 'ts', 'tsx', 'js', 'json', 'jsonc', 'yaml', 'sql', 'text', 'txt', 'dotenv', 'mermaid', 'diff', 'md', 'mdx', 'toml', 'html', 'css'])

const errors = []

/** Lists every file under a folder, recursively. */
function walk(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

/** Reads flat `key: value` frontmatter. Docs frontmatter has no nesting. */
function readFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/)
  if (!match) return null
  return Object.fromEntries(
    match[1]
      .split('\n')
      .map((line) => line.match(/^([a-z_]+):\s*(.*)$/))
      .filter(Boolean)
      .map(([, key, value]) => [key, value.replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim()]),
  )
}

/** Drops fenced code blocks so example links and paths are not checked. */
function withoutCodeFences(text) {
  return text.replace(/^```[\s\S]*?^```/gm, '')
}

const pages = [
  path.join(docsRoot, 'index.mdx'),
  ...siteFolders.flatMap((folder) => walk(path.join(docsRoot, folder))).filter((file) => /\.mdx?$/.test(file)),
]
const today = Date.now()

for (const file of pages) {
  const rel = path.relative(process.cwd(), file)
  const text = readFileSync(file, 'utf8')
  const frontmatter = readFrontmatter(text)

  if (!frontmatter) {
    errors.push(`${rel}: missing frontmatter`)
    continue
  }
  for (const field of requiredFields) {
    if (!frontmatter[field]) errors.push(`${rel}: frontmatter is missing \`${field}\``)
  }
  for (const line of text.match(/^---\n([\s\S]*?)\n---\n/)[1].split('\n')) {
    const value = line.match(/^[a-z_]+:\s+(.*)$/)?.[1] ?? ''
    if (value.includes(': ') && !/^["']/.test(value)) {
      errors.push(`${rel}: quote the frontmatter value in \`${line.slice(0, 40)}\``)
    }
  }
  for (const [, language] of text.matchAll(fencePattern)) {
    if (!fenceLanguages.has(language)) errors.push(`${rel}: code fence language \`${language}\` is not loaded`)
  }
  if (frontmatter.status && !statuses.has(frontmatter.status)) {
    errors.push(`${rel}: unknown status \`${frontmatter.status}\``)
  }
  if (frontmatter.status === 'current' && frontmatter.last_reviewed) {
    const ageDays = (today - Date.parse(frontmatter.last_reviewed)) / 86_400_000
    if (Number.isNaN(ageDays)) errors.push(`${rel}: last_reviewed is not a date`)
    else if (ageDays > maxReviewAgeDays) {
      errors.push(`${rel}: last reviewed ${Math.floor(ageDays)} days ago. Re-verify it and update last_reviewed.`)
    }
  }

  if (rel.startsWith(path.join('docs', 'archive'))) continue
  const body = withoutCodeFences(text)

  for (const [, url] of body.matchAll(linkPattern)) {
    const target = url.split('#')[0]
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/')) continue
    if (!existsSync(path.resolve(path.dirname(file), decodeURIComponent(target)))) {
      errors.push(`${rel}: broken link \`${url}\``)
    }
  }

  for (const [, repoPath] of body.matchAll(repoPathPattern)) {
    if (/[*<>{}$]/.test(repoPath)) continue
    const clean = repoPath.replace(/[.,:;)]+$/, '').replace(/#.*$/, '')
    if (!existsSync(path.resolve(clean))) errors.push(`${rel}: path \`${clean}\` does not exist`)
  }
}

for (const metaFile of walk(docsRoot).filter((file) => path.basename(file) === 'meta.json')) {
  const dir = path.dirname(metaFile)
  const entries = JSON.parse(readFileSync(metaFile, 'utf8')).pages ?? []
  for (const entry of entries) {
    if (entry === '...' || entry.startsWith('---') || entry.startsWith('[') || entry.startsWith('!')) continue
    const base = path.join(dir, entry)
    const found = [base, `${base}.md`, `${base}.mdx`].some((candidate) => existsSync(candidate))
    if (!found) errors.push(`${path.relative(process.cwd(), metaFile)}: sidebar entry \`${entry}\` does not exist`)
  }
}

if (errors.length > 0) {
  console.error(`verify:docs found ${errors.length} problem(s):\n`)
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log(`verify:docs: ${pages.length} pages OK`)
