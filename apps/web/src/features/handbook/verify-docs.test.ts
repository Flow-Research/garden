// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const script = fileURLToPath(
  new URL('../../../../../scripts/verify-docs.mjs', import.meta.url),
)
const today = new Date().toISOString().slice(0, 10)
const roots: string[] = []

/**
 * Builds a throwaway repository with a `docs/` tree and runs `verify-docs.mjs`
 * in it, the same way CI runs `pnpm verify:docs` from the repository root.
 */
function runOn(files: Record<string, string>) {
  const root = mkdtempSync(path.join(tmpdir(), 'verify-docs-'))
  roots.push(root)
  const tree = { 'docs/index.mdx': page('Home'), ...files }
  for (const [file, text] of Object.entries(tree)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), text)
  }
  const result = spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: 'utf8',
  })
  return { code: result.status, output: `${result.stdout}${result.stderr}` }
}

/** A valid page with the required frontmatter and the given body. */
function page(
  title: string,
  body = '',
  overrides: Record<string, string> = {},
): string {
  const fields = {
    title,
    description: 'A test page.',
    status: 'current',
    owner: '"@Umoren"',
    last_reviewed: today,
    ...overrides,
  }
  const frontmatter = Object.entries(fields)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n')
  return `---\n${frontmatter}\n---\n\n${body}\n`
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true })
})

describe('verify-docs', () => {
  it('passes a tree whose links, paths, and sidebar entries all exist', () => {
    const result = runOn({
      'docs/reference/a.md': page(
        'A',
        'See [B](./b.md#top) and `docs/reference/b.md`.',
      ),
      'docs/reference/b.md': page('B'),
      'docs/reference/meta.json': JSON.stringify({ pages: ['a', 'b', '...'] }),
    })
    expect(result.output).toContain('3 pages OK')
    expect(result.code).toBe(0)
  })

  it('fails a page with missing frontmatter or an unknown status', () => {
    const result = runOn({
      'docs/guides/no-frontmatter.md': '# No frontmatter\n',
      'docs/guides/bad-status.md': page('Bad', '', { status: 'draft' }),
    })
    expect(result.code).toBe(1)
    expect(result.output).toContain(
      'docs/guides/no-frontmatter.md: missing frontmatter',
    )
    expect(result.output).toContain('unknown status `draft`')
  })

  it('fails a current page that has not been reviewed in 90 days', () => {
    const result = runOn({
      'docs/concepts/old.md': page('Old', '', { last_reviewed: '2020-01-01' }),
    })
    expect(result.code).toBe(1)
    expect(result.output).toContain('docs/concepts/old.md: last reviewed')
  })

  it('fails a broken link, a missing repository path, and a missing sidebar entry', () => {
    const result = runOn({
      'docs/reference/a.md': page(
        'A',
        '[Gone](./gone.md) and `apps/web/src/missing.ts`.',
      ),
      'docs/reference/meta.json': JSON.stringify({
        pages: ['a', 'not-a-page'],
      }),
    })
    expect(result.code).toBe(1)
    expect(result.output).toContain('broken link `./gone.md`')
    expect(result.output).toContain(
      'path `apps/web/src/missing.ts` does not exist',
    )
    expect(result.output).toContain('sidebar entry `not-a-page` does not exist')
  })

  it('fails an unquoted frontmatter value with a colon and an unknown fence language', () => {
    const result = runOn({
      'docs/guides/yaml.md': page('Yaml', '```env\nKEY=value\n```', {
        description: 'Snapshot of the audit: findings',
      }),
    })
    expect(result.code).toBe(1)
    expect(result.output).toContain('quote the frontmatter value')
    expect(result.output).toContain('code fence language `env` is not loaded')
  })

  it('skips link and path checks in archive pages', () => {
    const result = runOn({
      'docs/archive/old.md': page(
        'Old',
        '[Gone](./gone.md) and `apps/removed.ts`.',
        {
          status: 'archived',
          last_reviewed: '2020-01-01',
        },
      ),
    })
    expect(result.output).toContain('2 pages OK')
    expect(result.code).toBe(0)
  })
})
