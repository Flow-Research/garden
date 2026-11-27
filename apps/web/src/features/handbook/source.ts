import { loader } from 'fumadocs-core/source'
import { defineDocs } from 'fumadocs-mdx/macro'
import { handbookBasePath } from './base-path'

/**
 * The handbook renders the repository's `docs/` folder, so a merged pull
 * request updates the site with no second copy to keep in sync. Only the
 * Diátaxis folders are pages. `docs/README.md` stays a GitHub and agent
 * reading guide, and `assets/`, `templates/`, and `garden-os/` are not pages.
 *
 * `applyMdxPreset` keeps Fumadocs' default heading, TOC, and code plugins;
 * a collection-level `mdxOptions` alone would drop them. `async` keeps each
 * page in its own lazily loaded chunk.
 *
 * The preset and `remarkHandbookLinks` are imported inside the options
 * object, not at the top of the file. The macro transform replaces the whole
 * `defineDocs` options object in app code but keeps top-level imports, and
 * this module ships to the browser through the handbook route. Top-level
 * imports pulled `fumadocs-core/mdx-plugins` and the remark plugin's
 * `node:path` and `node:url` into the client, so no page hydrated in vite
 * dev. The imports are awaited while the build-time
 * evaluator loads this module: deferring it into the `mdxOptions` function
 * failed every MDX compile with "Vite module runner has been closed", because
 * vite's `runnerImport` closes its runner once the module has loaded.
 * Reference: fumadocs-mdx 15.4.0 `transformMacroModule`,
 * `transformMacroConfigModule`, and `createMacroEvaluator`; vite 8
 * `runnerImport`.
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
    mdxOptions: await Promise.all([
      import('fumadocs-mdx/config'),
      import('./remark-handbook-links'),
    ]).then(([{ applyMdxPreset }, { remarkHandbookLinks }]) =>
      applyMdxPreset({
        remarkPlugins: (defaults) => [...defaults, remarkHandbookLinks],
      }),
    ),
  },
  meta: {
    files: ['meta.json', '*/**/meta.json'],
  },
})

export const handbookSource = loader({
  source: handbookDocs.toFumadocsSource(),
  baseUrl: handbookBasePath,
})
