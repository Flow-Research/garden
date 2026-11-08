// @vitest-environment node
import { fileURLToPath } from 'node:url'
import type { Link, Root } from 'mdast'
import type { VFile } from 'vfile'
import { describe, expect, it } from 'vitest'
import {
  handbookUrlForDocsPath,
  remarkHandbookLinks,
} from './remark-handbook-links'

const docsRoot = fileURLToPath(new URL('../../../../../docs/', import.meta.url))
const sourcePage = `${docsRoot}concepts/architecture/run-engine.md`

/** Runs the plugin on one link written in `docs/concepts/architecture/run-engine.md`. */
function rewrite(url: string, path: string | null = sourcePage): string {
  const link: Link = { type: 'link', url, children: [] }
  const tree: Root = {
    type: 'root',
    children: [{ type: 'paragraph', children: [link] }],
  }
  remarkHandbookLinks()(tree, { path: path ?? undefined } as VFile)
  return link.url
}

describe('handbookUrlForDocsPath', () => {
  it('drops the extension and maps index files to their folder', () => {
    expect(handbookUrlForDocsPath('reference/known-gaps.md')).toBe(
      '/handbook/reference/known-gaps',
    )
    expect(handbookUrlForDocsPath('guides/develop/ship-a-change.mdx')).toBe(
      '/handbook/guides/develop/ship-a-change',
    )
    expect(handbookUrlForDocsPath('index.mdx')).toBe('/handbook')
    expect(handbookUrlForDocsPath('concepts/index.md')).toBe(
      '/handbook/concepts',
    )
  })
})

describe('remarkHandbookLinks', () => {
  it('turns a relative docs link into its handbook URL', () => {
    expect(rewrite('../../reference/known-gaps.md')).toBe(
      '/handbook/reference/known-gaps',
    )
    expect(rewrite('./realtime.md')).toBe(
      '/handbook/concepts/architecture/realtime',
    )
  })

  it('keeps the anchor on a rewritten link', () => {
    expect(rewrite('./realtime.md#workspace-hub')).toBe(
      '/handbook/concepts/architecture/realtime#workspace-hub',
    )
  })

  it('sends a link to a repository file outside docs to GitHub on dev', () => {
    expect(rewrite('../../../AGENTS.md')).toBe(
      'https://github.com/Flow-Research/garden/blob/dev/AGENTS.md',
    )
    expect(rewrite('../../../apps/web/wrangler.jsonc#L10')).toBe(
      'https://github.com/Flow-Research/garden/blob/dev/apps/web/wrangler.jsonc#L10',
    )
  })

  it('leaves absolute URLs, site paths, and in-page anchors alone', () => {
    expect(rewrite('https://diataxis.fr')).toBe('https://diataxis.fr')
    expect(rewrite('mailto:team@example.com')).toBe('mailto:team@example.com')
    expect(rewrite('/handbook/reference/known-gaps')).toBe(
      '/handbook/reference/known-gaps',
    )
    expect(rewrite('#open-gaps')).toBe('#open-gaps')
  })

  it('leaves a link that climbs out of the repository alone', () => {
    expect(rewrite('../../../../outside.md')).toBe('../../../../outside.md')
  })

  it('does nothing when the file has no path', () => {
    expect(rewrite('./realtime.md', null)).toBe('./realtime.md')
  })
})
