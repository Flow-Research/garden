// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * A Tailwind class that names a colour token which does not exist generates
 * no CSS at all, silently. `text-text-brand-onBrand` (instead of
 * `-on-brand`) left the selected Issues scope tab dark-on-dark this way.
 * This checks every semantic colour class in the web app and the UI package
 * against the `--color-*` theme variables.
 */

const WEB_SRC = fileURLToPath(new URL('..', import.meta.url))
const UI_ROOT = fileURLToPath(
  new URL('../../../../packages/ui', import.meta.url),
)

function files(dir: string, accept: (name: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules') return []
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return files(path, accept)
    return accept(name) ? [path] : []
  })
}

const themeColors = new Set(
  files(join(UI_ROOT, 'styles'), (name) => name.endsWith('.css'))
    .concat(files(WEB_SRC, (name) => name.endsWith('.css')))
    .flatMap((path) =>
      [...readFileSync(path, 'utf8').matchAll(/--color-([a-z0-9-]+)\s*:/g)].map(
        (match) => match[1] ?? '',
      ),
    ),
)

// utility-<semantic colour>[/<opacity>], e.g. text-text-brand-on-brand,
// hover:bg-background-main-secondary-hover, border-border-default/60.
const SEMANTIC_CLASS =
  /(?:^|[\s"'`:])(?:text|bg|border|ring|fill|stroke|outline|divide|placeholder|caret|decoration)-((?:text|background|border|icon)-[A-Za-z0-9-]+)(?:\/\d+)?(?=[\s"'`]|$)/g

describe('design tokens', () => {
  it('found the theme colours', () => {
    expect(themeColors.size).toBeGreaterThan(100)
  })

  it('uses only semantic colour classes that exist', () => {
    const sources = files(WEB_SRC, (name) => /\.(tsx?|css)$/.test(name))
      .concat(files(UI_ROOT, (name) => /\.tsx?$/.test(name)))
      .filter((path) => !/\.test\.tsx?$/.test(path))
    const unknown: string[] = []
    for (const path of sources) {
      for (const match of readFileSync(path, 'utf8').matchAll(SEMANTIC_CLASS)) {
        const colour = match[1] ?? ''
        if (!themeColors.has(colour)) {
          const file = relative(WEB_SRC, path).replaceAll('\\', '/')
          unknown.push(`${file}: ${colour}`)
        }
      }
    }
    expect(unknown).toEqual([])
  })
})
