import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { deflateRawSync } from 'node:zlib'
import {
  checkFailures,
  diagramPages,
  embeddedSource,
  pageLabels,
} from './diagrams.mjs'

const name = 'garden-deployment'
const svg = readFileSync(
  new URL(`../docs/diagrams/${name}.drawio.svg`, import.meta.url),
  'utf8',
)
const manifest = { diagrams: { [name]: { title: 'Deployment', watches: [] } } }
const check = (text, m = manifest) =>
  checkFailures({ manifest: m, svgs: { [name]: text } })

test('the committed export passes', () => {
  assert.deepEqual(check(svg), [])
})

test('the source has labels to compare, including object labels', () => {
  const labels = pageLabels(diagramPages(embeddedSource(svg))[0])
  assert.ok(labels.length > 5)
  assert.ok(labels.includes('Garden bindings'))
})

test('editing only the embedded source fails as out of sync', () => {
  const edited = svg.replace(
    /(<svg\b[^>]*\scontent="[^"]*?value=&quot;)/,
    '$1Renamed box ',
  )
  assert.notEqual(edited, svg)
  const failures = check(edited)
  assert.equal(failures.length, 1)
  assert.match(failures[0], /out of sync/)
  assert.match(
    failures[0],
    /pnpm diagrams:export docs\/diagrams\/garden-deployment/,
  )
})

test('a missing date line fails', () => {
  const failures = check(svg.replaceAll('CHECKED AGAINST GARDEN', 'CHECKED'))
  assert.ok(failures.some((f) => /CHECKED AGAINST GARDEN/.test(f)))
})

test('raster fallbacks and dark-mode colours fail', () => {
  const raster = svg.replace('</foreignObject>', '</foreignObject><image/>')
  assert.match(check(raster)[0], /raster fallback/)
  assert.match(
    check(svg.replace('<svg ', '<svg data-x="light-dark(" '))[0],
    /raster fallback or a dark-mode/,
  )
})

test('manifest and files must match both ways', () => {
  assert.match(
    check(svg, { diagrams: {} })[0],
    /is not in docs\/diagrams\/manifest\.json/,
  )
  const extra = {
    diagrams: { ...manifest.diagrams, other: { title: 'x', watches: [] } },
  }
  assert.match(check(svg, extra)[0], /lists other but .* is missing/)
})

test('a file without embedded source fails', () => {
  assert.match(
    check(svg.replace(/\scontent="[^"]*"/, ''))[0],
    /no embedded draw\.io source/,
  )
})

test('compressed pages decode to the same XML', () => {
  const xml =
    '<mxGraphModel><root><mxCell id="0" value="A &amp;amp; B"/></root></mxGraphModel>'
  const packed = deflateRawSync(encodeURIComponent(xml)).toString('base64')
  const pages = diagramPages(
    `<mxfile><diagram id="d">${packed}</diagram></mxfile>`,
  )
  assert.deepEqual(pages, [xml])
  assert.deepEqual(pageLabels(pages[0]), ['A & B'])
})
