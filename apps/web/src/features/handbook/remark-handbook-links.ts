import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Link, Root } from 'mdast'
import { visit } from 'unist-util-visit'
import type { VFile } from 'vfile'

const githubBlobBase = 'https://github.com/Flow-Research/garden/blob/dev/'
export const handbookBasePath = '/handbook'

/**
 * Converts a path inside `docs/` to its handbook URL. `index` files map to
 * their folder, and the `.md` or `.mdx` extension is dropped, matching the
 * slugs Fumadocs builds from the same files.
 */
export function handbookUrlForDocsPath(docsRelativePath: string): string {
  const withoutExtension = docsRelativePath.replace(/\.mdx?$/, '')
  const slug = withoutExtension.replace(/(^|\/)index$/, '')
  return slug ? `${handbookBasePath}/${slug}` : handbookBasePath
}

/**
 * Docs keep relative Markdown links so they read correctly on GitHub. The
 * handbook serves the same files at `/handbook/...`, where those relative
 * links would 404. This remark plugin rewrites them at build time:
 *
 * - a link to another page inside `docs/` becomes its handbook URL;
 * - a link to any other repository file becomes a GitHub URL on `dev`.
 *
 * Absolute URLs, in-page anchors, and links that leave the repository are
 * left unchanged.
 */
export function remarkHandbookLinks() {
  // Resolved here, not at module load: this module also ships in the Worker
  // bundle through `source.ts`, where `import.meta.url` is not a file URL and
  // `new URL(...)` threw on import, which failed every server-rendered page
  // with a 500 on garden-dev. The plugin itself only runs during the MDX build.
  const docsRoot = fileURLToPath(new URL('../../../../../docs/', import.meta.url))
  const repoRoot = path.resolve(docsRoot, '..')

  return (tree: Root, file: VFile) => {
    const sourcePath = file.path
    if (!sourcePath) return

    visit(tree, 'link', (node: Link) => {
      const [target, anchor] = node.url.split('#', 2)
      if (
        !target ||
        /^[a-z][a-z0-9+.-]*:/i.test(target) ||
        target.startsWith('/')
      ) {
        return
      }

      const resolved = path.resolve(path.dirname(sourcePath), target)
      const fragment = anchor ? `#${anchor}` : ''
      const docsRelative = path.relative(docsRoot, resolved)
      const insideDocs = !docsRelative.startsWith('..')

      if (insideDocs && /\.mdx?$/.test(docsRelative)) {
        node.url = `${handbookUrlForDocsPath(docsRelative.split(path.sep).join('/'))}${fragment}`
        return
      }

      const repoRelative = path.relative(repoRoot, resolved)
      if (repoRelative.startsWith('..')) return
      node.url = `${githubBlobBase}${repoRelative.split(path.sep).join('/')}${fragment}`
    })
  }
}
