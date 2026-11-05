import { loader } from 'fumadocs-core/source'
import { applyMdxPreset } from 'fumadocs-mdx/config'
import { defineDocs } from 'fumadocs-mdx/macro'
import { handbookBasePath, remarkHandbookLinks } from './remark-handbook-links'

export const handbookRoute = handbookBasePath

/**
 * The handbook renders the repository's `docs/` folder, so a merged pull
 * request updates the site with no second copy to keep in sync. Only the
 * Diátaxis folders are pages. `docs/README.md` stays a GitHub and agent
 * reading guide, and `assets/`, `templates/`, and `garden-os/` are not pages.
 *
 * `applyMdxPreset` keeps Fumadocs' default heading, TOC, and code plugins;
 * a collection-level `mdxOptions` alone would drop them. `async` keeps each
 * page in its own lazily loaded chunk. Reference: fumadocs-mdx 15.4.0
 * `DocMacroOptions` and `applyMdxPreset` typings.
 */
export const handbookDocs = defineDocs({
  dir: '../../docs',
  docs: {
    async: true,
    files: [
      'index.mdx',
      'tutorials/**/*.{md,mdx}',
      'guides/**/*.{md,mdx}',
      'concepts/**/*.{md,mdx}',
      'reference/**/*.{md,mdx}',
      'decisions/**/*.{md,mdx}',
      'proposals/**/*.{md,mdx}',
      'archive/**/*.{md,mdx}',
    ],
    mdxOptions: applyMdxPreset({
      remarkPlugins: (defaults) => [...defaults, remarkHandbookLinks],
    }),
  },
  meta: {
    files: ['meta.json', '*/**/meta.json'],
  },
})

export const handbookSource = loader({
  source: handbookDocs.toFumadocsSource(),
  baseUrl: handbookRoute,
})
