import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { crc32, deflateSync } from 'node:zlib'

// Use the existing web fixture deadline for child processes.
const fixtureTimeoutMs = 120_000

const exceljsRequire = createRequire(import.meta.resolve('exceljs'))
const archiverRequire = createRequire(exceljsRequire.resolve('archiver'))
const archiverUtilsRequire = createRequire(
  archiverRequire.resolve('archiver-utils'),
)
const typeormRequire = createRequire(
  createRequire(
    createRequire(import.meta.resolve('@executor-js/fumadb')).resolve(
      'kysely-typeorm',
    ),
  ).resolve('typeorm'),
)
const justBashRequire = createRequire(
  createRequire(import.meta.resolve('@cloudflare/think')).resolve('just-bash'),
)
const postcssRequire = createRequire(import.meta.resolve('postcss'))
const babelRequire = createRequire(
  createRequire(
    createRequire(
      createRequire(
        import.meta.resolve('@tanstack/react-start/package.json'),
      ).resolve('@tanstack/router-utils'),
    ).resolve('babel-dead-code-elimination'),
  ).resolve('@babel/core'),
)

const minimatchOwners = [
  [
    'ExcelJS archive glob',
    createRequire(archiverUtilsRequire.resolve('glob'))('minimatch'),
  ],
  [
    'ExcelJS archive directory reader',
    createRequire(archiverRequire.resolve('readdir-glob'))('minimatch'),
  ],
  ['TypeORM glob', createRequire(typeormRequire.resolve('glob'))('minimatch')],
  ['just-bash', justBashRequire('minimatch')],
]

// Input sizes come from the brace-expansion advisories GHSA-qhr7-859c-m2p7 and
// GHSA-6j4f-fj2g-mc7p. Each one exhausted the stack before the patched releases.
const nestedPatterns = [
  ['nested comma members', `${'{a,'.repeat(4000)}z${'}'.repeat(4000)}`],
  ['a nested single set', `${'{'.repeat(3200)}a,b${'}'.repeat(3200)}`],
]
const chainedPattern = `{${'{a},'.repeat(7000)}b}`

for (const [owner, loaded] of minimatchOwners) {
  const minimatch = typeof loaded === 'function' ? loaded : loaded.minimatch

  test(`${owner} expands brace sets and bounds nested brace input`, () => {
    assert.deepEqual(minimatch.braceExpand('a{b,c}{1..2}'), [
      'ab1',
      'ab2',
      'ac1',
      'ac2',
    ])
    assert.equal(minimatch('src/a.ts', 'src/*.{ts,tsx}'), true)
    assert.equal(minimatch('src/a.md', 'src/*.{ts,tsx}'), false)
    for (const [label, pattern] of nestedPatterns) {
      assert.equal(minimatch.braceExpand(pattern).length, 1, label)
      assert.equal(minimatch('x', pattern), false, label)
    }
    assert.equal(minimatch.braceExpand(chainedPattern).length, 7001)
    assert.equal(minimatch('b', chainedPattern), true)
    assert.equal(minimatch('x', chainedPattern), false)
  })
}

test('the glob owners still read files and return from nested brace patterns', () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const archiveGlob = archiverUtilsRequire('glob')
  const typeormGlob = typeormRequire('glob')
  assert.deepEqual(archiveGlob.sync('{package,turbo}.json', { cwd: root }), [
    'package.json',
    'turbo.json',
  ])
  assert.deepEqual(
    typeormGlob.globSync('{package,turbo}.json', { cwd: root }).sort(),
    ['package.json', 'turbo.json'],
  )
  const [, pattern] = nestedPatterns[1]
  assert.deepEqual(typeormGlob.globSync(pattern, { cwd: root }), [])
  // glob 7 returns an unmatched pattern that has no glob characters left.
  assert.ok(archiveGlob.sync(pattern, { cwd: root }).length <= 1)
})

test('Babel resolves browser targets through its installed Browserslist', () => {
  const babel = babelRequire('@babel/core')
  const options = babel.loadOptions({
    targets: 'chrome 100, firefox 90',
    browserslistConfigFile: false,
    configFile: false,
    babelrc: false,
  })
  assert.deepEqual(options.targets, { chrome: '100.0.0', firefox: '90.0.0' })
})

test('Browserslist reads custom usage statistics that hold inherited key names', () => {
  const browserslist = createRequire(
    babelRequire.resolve('@babel/helper-compilation-targets'),
  )('browserslist')
  const stats = JSON.parse(
    '{"toString":{"onekey":5},"constructor":{"onekey":5},"__proto__":{"polluted":1},"chrome":{"100":50}}',
  )
  assert.deepEqual(browserslist('> 10% in my stats', { stats }), ['chrome 100'])
  assert.equal(Reflect.get({}, 'polluted'), undefined)
  assert.throws(() => browserslist('unknown-browser 1'), /Unknown/)
})

test('the PostCSS identifier generator ends when the size is zero', () => {
  // A regression here is an endless synchronous loop, so the check runs in a
  // child process that the parent can stop.
  const child = spawnSync(
    process.execPath,
    [
      '-e',
      `const { createRequire } = require('node:module')
const owner = createRequire(${JSON.stringify(postcssRequire.resolve('postcss'))})
const secure = owner('nanoid')
const plain = owner('nanoid/non-secure')
const zeroBytes = (size) => new Uint8Array(size)
process.stdout.write(JSON.stringify([
  secure.customAlphabet('ab', 0)(),
  secure.customAlphabet('ab', 5)(0),
  secure.customRandom('ab', 0, zeroBytes)(),
  plain.customAlphabet('ab', 0)(),
  secure.customAlphabet('ab', 5)().length,
  plain.nanoid().length,
]))`,
    ],
    { encoding: 'utf8', timeout: fixtureTimeoutMs },
  )
  assert.equal(child.status, 0, child.stderr)
  assert.deepEqual(JSON.parse(child.stdout), ['', '', '', '', 5, 21])
})

const sourceMap = {
  version: 3,
  sources: ['input.css'],
  names: [],
  mappings: 'AAAA',
  sourcesContent: ['a{color:red}'],
}

test('PostCSS retains a previous source map through its source-map owner', async () => {
  const postcss = postcssRequire('postcss')
  const result = await postcss().process('a{color:red}', {
    from: 'input.css',
    to: 'output.css',
    map: { prev: JSON.stringify(sourceMap), inline: false },
  })
  assert.deepEqual(JSON.parse(result.map.toString()), {
    ...sourceMap,
    file: 'output.css',
  })
})

test('the PostCSS source-map owner refuses extreme indexed section offsets', async () => {
  const postcss = postcssRequire('postcss')
  const { SourceMapConsumer } = postcssRequire('source-map-js')
  const indexed = (line) => ({
    version: 3,
    sections: [{ offset: { line, column: 0 }, map: sourceMap }],
  })
  const mappings = []
  new SourceMapConsumer(indexed(2)).eachMapping((mapping) =>
    mappings.push([
      mapping.source,
      mapping.generatedLine,
      mapping.originalLine,
    ]),
  )
  assert.deepEqual(mappings, [['input.css', 3, 1]])
  for (const line of [1_000_000_000, 2 ** 53, -1, 1.5]) {
    assert.throws(
      () => new SourceMapConsumer(indexed(line)),
      /Section offset line/,
    )
    await assert.rejects(async () => {
      const result = await postcss().process('a{color:red}', {
        from: 'input.css',
        to: 'output.css',
        map: { prev: JSON.stringify(indexed(line)), inline: false },
      })
      return result.map.toString()
    }, /Section offset line/)
  }
})

function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data])
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(body) >>> 0)
  return Buffer.concat([length, body, checksum])
}

/** Builds a grey RGB PNG without an image library, so the input is independent of Sharp. */
function greyPng(width, height) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x7f)])
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(Buffer.concat(Array(height).fill(row)))),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

test('the screenshot script converts PNG and SVG input and refuses a truncated image', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'garden-screenshot-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const script = fileURLToPath(
    new URL('./screenshot-webp.mjs', import.meta.url),
  )
  const run = (...args) =>
    spawnSync(process.execPath, [script, ...args], {
      cwd: directory,
      encoding: 'utf8',
      timeout: fixtureTimeoutMs,
    })
  await writeFile(join(directory, 'shot.png'), greyPng(8, 4))
  await writeFile(
    join(directory, 'vector.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="6" height="3"><rect width="6" height="3" fill="#0a0"/></svg>',
  )
  await writeFile(join(directory, 'broken.png'), greyPng(8, 4).subarray(0, 40))

  const converted = run(
    '424242',
    join(directory, 'shot.png'),
    join(directory, 'vector.svg'),
  )
  assert.equal(converted.status, 0, converted.stderr)
  const folder = join(directory, 'docs/assets/pr/424242')
  assert.deepEqual((await readdir(folder)).sort(), ['shot.webp', 'vector.webp'])
  const sharp = createRequire(script)('sharp')
  for (const [name, width, height] of [
    ['shot.webp', 8, 4],
    ['vector.webp', 6, 3],
  ]) {
    const output = await readFile(join(folder, name))
    assert.equal(output.subarray(0, 4).toString('latin1'), 'RIFF')
    assert.equal(output.subarray(8, 12).toString('latin1'), 'WEBP')
    const metadata = await sharp(output).metadata()
    assert.deepEqual(
      [metadata.format, metadata.width, metadata.height],
      ['webp', width, height],
    )
  }

  const refused = run('424243', join(directory, 'broken.png'))
  assert.notEqual(refused.status, 0)
  assert.match(refused.stderr, /corrupt header/)
  assert.deepEqual(await readdir(join(directory, 'docs/assets/pr/424243')), [])
})

test('Miniflare and the embedding library load one image library that reads images', async () => {
  const owners = [
    createRequire(import.meta.resolve('miniflare')),
    createRequire(
      createRequire(import.meta.resolve('wrangler')).resolve('miniflare'),
    ),
    createRequire(import.meta.resolve('@xenova/transformers')),
  ]
  const [sharp, ...others] = owners.map((owner) => owner('sharp'))
  for (const other of others) assert.equal(other, sharp)

  const { RawImage } = await import('@xenova/transformers')
  const image = await RawImage.fromBlob(new Blob([greyPng(8, 4)]))
  assert.deepEqual([image.width, image.height, image.channels], [8, 4, 3])
  const resized = await image.resize(4, 2)
  assert.deepEqual([resized.width, resized.height], [4, 2])
  assert.equal(resized.data.length, 4 * 2 * 3)
  await assert.rejects(
    RawImage.fromBlob(new Blob([greyPng(8, 4).subarray(0, 40)])),
  )
})
