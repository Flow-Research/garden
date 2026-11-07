// @vitest-environment node
import { fileURLToPath } from 'node:url'
import { build, createServer, type Rolldown } from 'vite'
import { fumadocsMdx } from 'fumadocs-mdx/vite'
import { describe, expect, it } from 'vitest'

const webRoot = fileURLToPath(new URL('../../..', import.meta.url))
const sourceModule = 'src/features/handbook/source.ts'

/**
 * `source.ts` reaches the browser through the handbook route, and its
 * `defineDocs` options also configure the MDX compiler at build time. These
 * tests run the real fumadocs vite plugin on both sides.
 */
describe('handbook source module', () => {
  /**
   * The macro transform replaces the `defineDocs` call but keeps the module's
   * other top-level imports. A static `fumadocs-mdx/config` import once stayed
   * in the client module and pulled `fumadocs-core/mdx-plugins` (which
   * imports `node:url`) into the browser, so no page hydrated in vite dev.
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
    const result = await server.environments.client.transformRequest(
      `/${sourceModule}`,
    )
    await server.close()

    expect(result?.code).toContain('fumadocs-mdx/dist/runtime/macro')
    expect(result?.code).not.toContain('fumadocs-mdx/dist/config')
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
