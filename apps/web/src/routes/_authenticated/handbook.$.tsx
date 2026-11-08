import { Suspense, use } from 'react'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useFumadocsLoader } from 'fumadocs-core/source/client'
import { RootProvider } from 'fumadocs-ui/provider/tanstack'
import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from 'fumadocs-ui/layouts/docs/page'
import defaultMdxComponents from 'fumadocs-ui/mdx'
import { z } from 'zod'
import handbookCss from '@/features/handbook/handbook.css?url'
import { handbookDocs, handbookSource } from '@/features/handbook/source'

/**
 * Resolves a handbook path to its page and the sidebar tree on the server.
 * The page tree is built from every MDX file at once, so it stays on the
 * server and ships to the browser serialized. Unknown paths raise the
 * router's not-found page.
 */
const loadHandbookPage = createServerFn({ method: 'GET' })
  .inputValidator(z.array(z.string()))
  .handler(async ({ data: slugs }) => {
    const page = handbookSource.getPage(slugs)
    if (!page) throw notFound()

    return {
      path: page.path,
      pageTree: await handbookSource.serializePageTree(
        handbookSource.getPageTree(),
      ),
    }
  })

export const Route = createFileRoute('/_authenticated/handbook/$')({
  loader: async ({ params }) => {
    const slugs = params._splat?.split('/').filter(Boolean) ?? []
    const data = await loadHandbookPage({ data: slugs })
    await handbookDocs.getPage(data.path)?.preload()
    return data
  },
  head: () => ({
    meta: [{ title: 'Garden Handbook' }],
    links: [{ rel: 'stylesheet', href: handbookCss }],
  }),
  component: HandbookPage,
})

/**
 * Garden already owns the theme through its own `next-themes` provider, so
 * Fumadocs' provider and theme toggle are disabled and the handbook follows
 * the app's light or dark setting. Search and its toggle are off until a
 * search route exists.
 */
function HandbookPage() {
  const { path, pageTree } = useFumadocsLoader(Route.useLoaderData())

  // Garden's root layout keeps <body> at `overflow-hidden` because app pages
  // scroll inside their own panels. The handbook owns a full-height scroll
  // container instead of changing <body>, because the router keeps this
  // route's stylesheet after client navigation away from the handbook.
  return (
    <div className="h-svh overflow-y-auto font-sans">
      <RootProvider theme={{ enabled: false }} search={{ enabled: false }}>
        <DocsLayout
          tree={pageTree}
          nav={{ title: 'Garden Handbook', url: '/handbook' }}
          themeSwitch={{ enabled: false }}
          searchToggle={{ enabled: false }}
        >
          <Suspense>
            <HandbookContent path={path} />
          </Suspense>
        </DocsLayout>
      </RootProvider>
    </div>
  )
}

function HandbookContent({ path }: { path: string }) {
  const page = handbookDocs.getPage(path)
  if (!page) throw notFound()

  const { toc } = use(page.load())
  const MDX = page.body

  return (
    <DocsPage toc={toc}>
      <DocsTitle>{page.title}</DocsTitle>
      <DocsDescription>{page.description}</DocsDescription>
      <DocsBody>
        <MDX components={defaultMdxComponents} />
      </DocsBody>
    </DocsPage>
  )
}
