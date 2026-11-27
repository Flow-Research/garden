// @vitest-environment node
import { fileURLToPath } from 'node:url'
import { build, createServer, type Rolldown } from 'vite'
import { fumadocsMdx } from 'fumadocs-mdx/vite'
import { describe, expect, it } from 'vitest'

const webRoot = fileURLToPath(new URL('../../..', import.meta.url))
const sourceModule = 'src/features/handbook/source.ts'
const handbookRouteModule = 'src/routes/_authenticated/handbook.$.tsx'
/**
 * What a build-time-only import looks like after vite's client transform:
 * Node built-ins become `__vite-browser-external` stubs that throw on use,
 * and the fumadocs MDX config and plugins resolve to their dist paths.
 */
const browserLeakMarkers = [
  '__vite-browser-external',
  'fumadocs-mdx/dist/config',
  'mdx-plugins',
]

/**
 * `source.ts` reaches the browser through the handbook route, and its
 * `defineDocs` options also configure the MDX compiler at build time. These
 * tests run the real fumadocs vite plugin on both sides.
 */
describe('handbook source module', () => {
  /**
   * The macro transform replaces the `defineDocs` call but keeps the module's
   * other top-level imports. Static imports of `fumadocs-mdx/config` and of
   * `remark-handbook-links.ts` (which imports `node:path` and `node:url`)
   * once stayed in the client module, so no page hydrated in vite dev. The
   * walk follows every `/src/` module the browser would load from here.
   */
  it('ships no build-time MDX config to the browser', async () => {
    const server = await createServer({
      root: webRoot,
      configFile: false,
      logLevel: 'silent',
      server: { middlewareMode: true, ws: false },
      optimizeDeps: { noDiscovery: true, include: [] },
      resolve: { tsconfigPaths: true },
      plugins: [fumadocsMdx()],
    })
    const leaks: string[] = []
    const seen = new Set<string>()
    const pending = [`/${sourceModule}`, `/${handbookRouteModule}`]
    for (let url = pending.pop(); url; url = pending.pop()) {
      if (seen.has(url)) continue
      seen.add(url)
      const result = await server.environments.client.transformRequest(url)
      const code = result?.code ?? ''
      for (const [specifier] of code.matchAll(/["'][^"'\s]+["']/g)) {
        if (browserLeakMarkers.some((marker) => specifier.includes(marker))) {
          leaks.push(`${url}: ${specifier}`)
        }
      }
      for (const [quoted] of code.matchAll(/["']\/src\/[^"'?]+/g)) {
        pending.push(quoted.slice(1))
      }
    }
    await server.close()

    expect(seen.size).toBeGreaterThan(1)
    expect(leaks).toEqual([])
  })

  /**
   * Compiles every handbook page through the build-time evaluator. A preset
   * loaded lazily inside `mdxOptions` failed here with "Vite module runner
   * has been closed"; the rewritten `/handbook/...` links prove the default
   * presets and `remarkHandbookLinks` both ran.
   */
  it('compiles handbook pages with the handbook remark plugins', async () => {
    const output = await build({
      root: webRoot,
      configFile: false,
      logLevel: 'silent',
      resolve: { tsconfigPaths: true },
      plugins: [fumadocsMdx()],
      build: {
        write: false,
        ssr: sourceModule,
        rolldownOptions: { external: [/^[a-z]/, /^@[a-z]/] },
      },
    })
    const chunks = (
      Array.isArray(output) ? output : [output]
    ) as Rolldown.RolldownOutput[]
    const code = chunks
      .flatMap((chunk) => chunk.output)
      .map((file) => ('code' in file ? file.code : ''))
      .join('\n')

    expect(code).toContain('"/handbook/')
    expect(code).toContain('toc')
  })
})
