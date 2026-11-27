import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { inflateRawSync } from 'node:zlib'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DIAGRAMS_DIR = 'docs/diagrams'
const MANIFEST_PATH = `${DIAGRAMS_DIR}/manifest.json`
const SUFFIX = '.drawio.svg'
const DATE_LINE = /CHECKED AGAINST GARDEN [0-9a-f]{7,40}\b/

/**
 * draw.io places a PNG copy of every HTML label after its foreignObject, for
 * renderers without foreignObject support. Browsers and GitHub render the
 * foreignObject, and the PNGs make each file about 1 MB.
 */
const RASTER_FALLBACK = /(<\/foreignObject>)<image\b[^>]*\/>/g

/**
 * Decode the XML entities draw.io writes in attributes and text.
 */
export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const value =
        code[1].toLowerCase() === 'x'
          ? Number.parseInt(code.slice(2), 16)
          : Number.parseInt(code.slice(1), 10)
      return String.fromCodePoint(value)
    }
    const named = {
      amp: '&',
      lt: '<',
      gt: '>',
      quot: '"',
      apos: "'",
      nbsp: ' ',
    }
    return named[code.toLowerCase()] ?? match
  })
}

/**
 * Return the mxfile XML embedded in a .drawio.svg `content` attribute, or
 * null when the file carries no editable source.
 */
export function embeddedSource(svg) {
  const match = /<svg\b[^>]*\scontent="([^"]*)"/.exec(svg)
  return match ? decodeEntities(match[1]) : null
}

/**
 * Return each page's mxGraphModel XML. draw.io may store a page compressed:
 * base64 of deflate-raw of the URI-encoded XML.
 */
export function diagramPages(mxfile) {
  return [...mxfile.matchAll(/<diagram\b[^>]*>([\s\S]*?)<\/diagram>/g)].map(
    ([, inner]) => {
      const text = inner.trim()
      if (text.startsWith('<')) return text
      return decodeURIComponent(
        inflateRawSync(Buffer.from(text, 'base64')).toString('utf8'),
      )
    },
  )
}

/**
 * Collapse text to a whitespace-free form so line wrapping and HTML markup
 * do not affect comparison.
 */
function squash(text) {
  return text.replace(/\s+/g, '')
}

/**
 * Return the visible label of every cell in one page, tags stripped. A cell
 * with custom properties keeps its label on a wrapping `object` element.
 */
export function pageLabels(page) {
  const label =
    /<(?:mxCell\b[^>]*\svalue|(?:object|UserObject)\b[^>]*\slabel)="([^"]*)"/g
  return [...page.matchAll(label)]
    .map(([, value]) =>
      decodeEntities(decodeEntities(value).replace(/<[^>]*>/g, ' ')),
    )
    .map((label) => label.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

/**
 * Return the text a reader sees in the rendered SVG body.
 */
function renderedText(svg) {
  const body = svg.replace(/\scontent="[^"]*"/, '')
  return decodeEntities(body.replace(/<[^>]*>/g, ' '))
}

/**
 * Check one .drawio.svg against the contract and return failure messages.
 */
export function svgFailures(name, svg) {
  const path = `${DIAGRAMS_DIR}/${name}${SUFFIX}`
  const reexport = `run pnpm diagrams:export ${path}`
  const failures = []

  if (svg.includes('<image') || svg.includes('light-dark(')) {
    failures.push(
      `${path} has a raster fallback or a dark-mode colour rule; ${reexport}`,
    )
  }

  const source = embeddedSource(svg)
  if (!source) {
    failures.push(
      `${path} has no embedded draw.io source; export it from the .drawio file with pnpm diagrams:export <file>.drawio`,
    )
    return failures
  }

  const pages = diagramPages(source)
  if (pages.length !== 1) {
    failures.push(
      `${path} must have exactly one page; it has ${pages.length}. Split extra pages into their own diagrams`,
    )
    return failures
  }

  const labels = pageLabels(pages[0])
  if (!labels.some((label) => DATE_LINE.test(label))) {
    failures.push(
      `${path} needs a date line containing "CHECKED AGAINST GARDEN <commit sha>"; edit it, then ${reexport}`,
    )
  }

  const rendered = squash(renderedText(svg))
  const missing = labels.filter((label) => !rendered.includes(squash(label)))
  if (missing.length > 0) {
    failures.push(
      `${path} picture is out of sync with its source (missing: "${missing[0]}"); ${reexport}`,
    )
  }

  return failures
}

/**
 * Check every diagram against the manifest. `svgs` maps diagram name to SVG
 * text for each .drawio.svg on disk.
 */
export function checkFailures({ manifest, svgs }) {
  const registered = Object.keys(manifest.diagrams ?? {})
  const failures = []

  for (const name of registered) {
    if (!(name in svgs)) {
      failures.push(
        `${MANIFEST_PATH} lists ${name} but ${DIAGRAMS_DIR}/${name}${SUFFIX} is missing; export it or remove the entry`,
      )
    }
  }

  for (const [name, svg] of Object.entries(svgs)) {
    if (!registered.includes(name)) {
      failures.push(
        `${DIAGRAMS_DIR}/${name}${SUFFIX} is not in ${MANIFEST_PATH}; add it with a title and the paths it watches`,
      )
      continue
    }
    failures.push(...svgFailures(name, svg))
  }

  return failures
}

/**
 * Strip raster fallbacks from a draw.io SVG export.
 */
export function stripRasterFallbacks(svg) {
  return svg.replace(RASTER_FALLBACK, '$1')
}

/**
 * Read the manifest and every .drawio.svg from the repository.
 */
function readDiagrams() {
  const manifest = JSON.parse(readFileSync(join(ROOT, MANIFEST_PATH), 'utf8'))
  const svgs = Object.fromEntries(
    readdirSync(join(ROOT, DIAGRAMS_DIR))
      .filter((file) => file.endsWith(SUFFIX))
      .map((file) => [
        file.slice(0, -SUFFIX.length),
        readFileSync(join(ROOT, DIAGRAMS_DIR, file), 'utf8'),
      ]),
  )
  return { manifest, svgs }
}

/**
 * Run the draw.io CLI. Linux without a display needs a virtual X server.
 */
function runDrawio(args) {
  const bin = process.env.DRAWIO_BIN || 'drawio'
  const drawioArgs = ['--no-sandbox', '--disable-gpu', ...args]
  const headless = process.platform === 'linux' && !process.env.DISPLAY
  const result = headless
    ? spawnSync('xvfb-run', ['-a', bin, ...drawioArgs], { encoding: 'utf8' })
    : spawnSync(bin, drawioArgs, { encoding: 'utf8' })
  if (result.error || result.status !== 0) {
    return `draw.io failed (${bin}): ${result.error?.message ?? result.stderr.trim()}. Set DRAWIO_BIN to the draw.io desktop binary`
  }
  return null
}

/**
 * Export one .drawio or .drawio.svg into docs/diagrams and return an error
 * message or null.
 */
function exportDiagram(input, workDir) {
  const isSvg = input.endsWith(SUFFIX)
  const name = basename(input).replace(/\.drawio(\.svg)?$/, '')
  const output = join(ROOT, DIAGRAMS_DIR, `${name}${SUFFIX}`)
  let source = input

  if (isSvg) {
    const xml = embeddedSource(readFileSync(input, 'utf8'))
    if (!xml) return `${input} has no embedded draw.io source to re-export`
    source = join(workDir, `${name}.drawio`)
    writeFileSync(source, xml)
  }

  const error = runDrawio([
    '-x',
    '-f',
    'svg',
    '--embed-diagram',
    '--theme',
    'light',
    '-o',
    output,
    source,
  ])
  if (error) return error

  writeFileSync(output, stripRasterFallbacks(readFileSync(output, 'utf8')))

  const smoke = join(workDir, `${name}.png`)
  const smokeError = runDrawio(['-x', '-f', 'png', '-o', smoke, output])
  if (smokeError || !existsSync(smoke)) {
    return `${output} did not re-open in draw.io: ${smokeError ?? 'no PNG written'}`
  }

  process.stdout.write(`exported ${relative(ROOT, output)}\n`)
  return null
}

/**
 * Command-line entry: `export [paths...]` or `check`.
 */
function main() {
  const [command, ...paths] = process.argv.slice(2)

  if (command === 'check') {
    const failures = checkFailures(readDiagrams())
    if (failures.length > 0) {
      process.stderr.write('Diagram check failed:\n')
      for (const failure of failures) process.stderr.write(`- ${failure}\n`)
      process.exitCode = 1
      return
    }
    process.stdout.write('Diagrams match their sources.\n')
    return
  }

  if (command === 'export') {
    const inputs =
      paths.length > 0
        ? paths
        : readdirSync(join(ROOT, DIAGRAMS_DIR))
            .filter((file) => file.endsWith(SUFFIX))
            .map((file) => join(ROOT, DIAGRAMS_DIR, file))
    const workDir = mkdtempSync(join(tmpdir(), 'garden-diagrams-'))
    for (const input of inputs) {
      const error = exportDiagram(input, workDir)
      if (error) {
        process.stderr.write(`- ${error}\n`)
        process.exitCode = 1
      }
    }
    rmSync(workDir, { recursive: true, force: true })
    return
  }

  process.stdout.write(
    'Usage: node scripts/diagrams.mjs export [paths...] | check\n' +
      'export renders .drawio or .drawio.svg files into docs/diagrams.\n' +
      'check verifies docs/diagrams against docs/diagrams/manifest.json.\n',
  )
  if (command !== '--help') process.exitCode = 1
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main()
