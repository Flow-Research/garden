import { Effect } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { searchExecutorCatalog } from './catalog'

/** Synthetic catalog covering every queryRank tier for "github" plus both
 * category spellings (UI underscore, preset hyphen). One fixture per file:
 * integrations.sh Effect Cache and the search projection memo are module-scoped
 * and only re-resolve when the fetched entries identity changes. */
const searchCatalogBody = {
  generatedAt: '2026-09-27T00:00:00.000Z',
  data: [
    {
      id: 'mcp/github-actions',
      kind: 'mcp',
      slug: 'github-actions',
      name: 'GitHub Actions',
      description: 'CI automation for repositories.',
      url: 'https://mcp.githubactions.example/mcp',
      icon: null,
      domain: 'githubactions.example',
      categories: ['developer_tools'],
      popularity: 50,
    },
    {
      id: 'mcp/my-github-tool',
      kind: 'mcp',
      slug: 'my-github-tool',
      name: 'My GITHUB Tool',
      description: 'A personal utility.',
      url: 'https://mcp.mygithubtool.example/mcp',
      icon: null,
      domain: 'mygithubtool.example',
      categories: ['developer_tools'],
      popularity: 40,
    },
    {
      id: 'mcp/octo-widget',
      kind: 'mcp',
      slug: 'octo-widget',
      name: 'Octo Widget',
      description: 'Widgets for projects.',
      url: 'https://mcp.octowidget.example/mcp',
      icon: null,
      domain: 'github-widgets.example',
      categories: ['developer_tools'],
      popularity: 30,
    },
    {
      id: 'mcp/acme-sync',
      kind: 'mcp',
      slug: 'acme-sync',
      name: 'Acme Sync',
      description: 'Syncs github issues nightly.',
      url: 'https://mcp.acmesync.example/mcp',
      icon: null,
      domain: 'acmesync.example',
      categories: ['productivity'],
      popularity: 20,
    },
    {
      id: 'mcp/browserbase-com',
      kind: 'mcp',
      slug: 'browserbase-com',
      name: 'browserbase.com',
      description: 'Browser automation.',
      url: 'https://mcp.browserbase.example/mcp',
      icon: null,
      domain: 'browserbase.com',
      categories: ['developer_tools'],
      popularity: 60,
    },
  ],
}

const search = (input: {
  query?: string
  category?: string
  limit?: number
  offset?: number
}) =>
  Effect.runPromise(
    searchExecutorCatalog({
      query: input.query ?? '',
      category: input.category ?? '',
      limit: input.limit ?? 100,
      offset: input.offset ?? 0,
    }),
  )

const entryNames = (entries: readonly { readonly name: string }[]): string[] =>
  entries.map((entry) => entry.name)

describe('connector search ranking', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('orders exact name match before prefix, substring, domain, and description hits', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(searchCatalogBody)),
    )

    const result = await search({ query: 'github' })
    const names = entryNames(result.entries)
    const at = (name: string): number => {
      const index = names.indexOf(name)
      expect(index, `expected "${name}" in [${names.join(', ')}]`).toBeGreaterThanOrEqual(0)
      return index
    }

    expect(at('GitHub')).toBe(0)
    expect(at('GitHub')).toBeLessThan(at('GitHub Actions'))
    expect(at('GitHub Actions')).toBeLessThan(at('My GITHUB Tool'))
    expect(at('My GITHUB Tool')).toBeLessThan(at('Octo Widget'))
    expect(at('Octo Widget')).toBeLessThan(at('Acme Sync'))
    const deepWiki = names.indexOf('DeepWiki')
    if (deepWiki !== -1) {
      expect(at('Octo Widget')).toBeLessThan(deepWiki)
    }
  })

  it('drops providers that only fail every rank tier', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(searchCatalogBody)),
    )

    const result = await search({ query: 'github' })

    expect(entryNames(result.entries)).not.toContain('browserbase.com')
    expect(result.total).toBe(result.entries.length)
  })
})

describe('connector search category filter', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('matches hyphenated presets when the UI sends underscore format', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(searchCatalogBody)),
    )

    const result = await search({ category: 'developer_tools' })
    const ids = result.entries.map((entry) => String(entry.providerId))

    expect(ids).toContain('github.com')
    expect(ids).toContain('githubactions.example')
    expect(ids.some((id) => id.includes('browserbase'))).toBe(true)
    expect(ids).not.toContain('acmesync.example')
  })

  it('matches underscore discoveries when the filter uses preset hyphen format', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(searchCatalogBody)),
    )

    const result = await search({ category: 'developer-tools' })
    const ids = result.entries.map((entry) => String(entry.providerId))

    expect(ids).toContain('github.com')
    expect(ids).toContain('githubactions.example')
    expect(ids).not.toContain('acmesync.example')
  })

  it('combines text search with the underscore category filter', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(searchCatalogBody)),
    )

    const result = await search({
      query: 'github',
      category: 'developer_tools',
    })
    const names = entryNames(result.entries)

    expect(names).toContain('GitHub')
    expect(names).toContain('GitHub Actions')
    expect(names).not.toContain('Acme Sync')
  })
})
