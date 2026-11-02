import { loader } from 'fumadocs-core/source'
import { defineDocs } from 'fumadocs-mdx/macro'

export const handbookRoute = '/handbook'

/**
 * Handbook pages live in the repository's `docs/handbook/` folder so they
 * change through pull requests next to the code they describe. The
 * `fumadocsMdx()` Vite plugin compiles this macro at build time; `async`
 * keeps each page's MDX in its own lazily loaded chunk. Reference: Fumadocs
 * TanStack Start template (create-fumadocs-app 16.2.28).
 */
export const handbookDocs = defineDocs({
  dir: '../../docs/handbook',
  docs: { async: true },
})

export const handbookSource = loader({
  source: handbookDocs.toFumadocsSource(),
  baseUrl: handbookRoute,
})
