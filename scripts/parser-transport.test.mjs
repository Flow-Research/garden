import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createServer as createSecureServer } from 'node:https'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { gzipSync } from 'node:zlib'

// Use the existing web fixture deadline for child and local transport checks.
const fixtureTimeoutMs = 120_000
const sdkRequire = createRequire(
  import.meta.resolve('@modelcontextprotocol/sdk/server/streamableHttp.js'),
)
const expressRequire = createRequire(sdkRequire.resolve('express'))
const codemodeRequire = createRequire(
  import.meta.resolve('@executor-js/codemode-core'),
)
const openApiRequire = createRequire(
  import.meta.resolve('@executor-js/plugin-openapi/core'),
)
const wranglerRequire = createRequire(import.meta.resolve('wrangler'))
const undiciOwners = [
  ['miniflare', createRequire(import.meta.resolve('miniflare'))],
  [
    'effect',
    createRequire(import.meta.resolve('@effect/platform-node/NodeHttpClient')),
  ],
]

async function listen(context, handler, tlsOptions) {
  const server = tlsOptions
    ? createSecureServer(tlsOptions, handler)
    : createServer(handler)
  context.after(async () => {
    server.closeAllConnections()
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  return `${tlsOptions ? 'https' : 'http'}://127.0.0.1:${address.port}`
}

test('AJV retains relative URI references through its installed URI parser', () => {
  const Ajv = codemodeRequire('ajv')
  const ajv = new Ajv({
    schemas: [{ $id: 'https://example.test/shared', type: 'string' }],
  })
  const validate = ajv.compile({
    $id: 'https://example.test/root',
    type: 'object',
    properties: { value: { $ref: './shared' } },
    required: ['value'],
  })
  assert.equal(validate({ value: 'expected' }), true)
  assert.equal(validate({ value: 42 }), false)
})

test('the AJV URI resolver normalizes authorities and refuses a non-numeric port', () => {
  const Ajv = codemodeRequire('ajv')
  const { uriResolver } = new Ajv().opts
  assert.equal(
    uriResolver.normalize('HTTP://Example.TEST:80/a/../b?q#f'),
    'http://example.test/b?q#f',
  )
  assert.equal(
    uriResolver.serialize({
      scheme: 'http',
      host: 'trusted.example',
      port: 8124,
      path: '/app',
    }),
    'http://trusted.example:8124/app',
  )
  assert.throws(
    () =>
      uriResolver.serialize({
        scheme: 'http',
        host: 'trusted.example',
        port: '@127.0.0.1:8124',
        path: '/app',
      }),
    /port is malformed/,
  )
})

test('the Executor OpenAPI YAML parser refuses an empty-merge sequence under its default schema', () => {
  const yaml = openApiRequire('js-yaml')
  const count = 800
  const source = `arr: &arr [${Array(count).fill('{}').join(',')}]\ntargets:\n${'  - <<: *arr\n'.repeat(count)}`
  assert.throws(() => yaml.load(source), /abnormal merge sequence size/)
  assert.deepEqual(yaml.load('base: &base { a: 1 }\nvalue:\n  <<: *base\n'), {
    base: { a: 1 },
    value: { a: 1 },
  })
})

test('the MCP Express owner retains JSON and form parsing with bounded refusal', async (context) => {
  const express = sdkRequire('express')
  const bodyParser = expressRequire('body-parser')
  const app = express()
  app.use(bodyParser.json({ limit: '4kb' }))
  app.use(bodyParser.urlencoded({ extended: true, limit: '4kb' }))
  app.post('/fixture', (request, response) => response.json(request.body))
  app.use((error, _request, response, _next) =>
    response.status(error.status ?? 500).json({ refused: true }),
  )
  const origin = await listen(context, app)
  const json = await fetch(`${origin}/fixture`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"value":"expected"}',
  })
  assert.deepEqual(await json.json(), { value: 'expected' })
  const form = await fetch(`${origin}/fixture`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'user[name]=expected',
  })
  assert.deepEqual(await form.json(), { user: { name: 'expected' } })
  const refused = await fetch(`${origin}/fixture`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"value":',
  })
  assert.equal(refused.status, 400)
  assert.deepEqual(await refused.json(), { refused: true })
  const oversized = await fetch(`${origin}/fixture`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value: 'a'.repeat(4096) }),
  })
  assert.equal(oversized.status, 413)
  assert.deepEqual(await oversized.json(), { refused: true })
  const frame = gzipSync('{"value":"expected"}')
  const compressed = await fetch(`${origin}/fixture`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
    body: frame,
  })
  assert.deepEqual(await compressed.json(), { value: 'expected' })
  const trailing = await fetch(`${origin}/fixture`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
    body: Buffer.concat([frame, Buffer.from('bytes-after-the-frame')]),
  })
  assert.equal(trailing.status, 400)
  assert.deepEqual(await trailing.json(), { refused: true })
  const afterTrailing = await fetch(`${origin}/fixture`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"value":"still-serving"}',
  })
  assert.deepEqual(await afterTrailing.json(), { value: 'still-serving' })
})

test('the Express body parser resolves a query parser inside its declared range', () => {
  const bodyParserRequire = createRequire(expressRequire.resolve('body-parser'))
  const declared = expressRequire('body-parser/package.json').dependencies.qs
  const [major, minor, patch] = bodyParserRequire('qs/package.json')
    .version.split('.')
    .map(Number)
  const [floorMajor, floorMinor, floorPatch] = /^\^(\d+)\.(\d+)\.(\d+)$/
    .exec(declared)
    .slice(1)
    .map(Number)
  assert.equal(major, floorMajor)
  assert.ok(minor > floorMinor || (minor === floorMinor && patch >= floorPatch))
})

test('the WHATWG fetch owner retains multipart parsing and invalid-body refusal', async () => {
  const { Request, FormData } = await import('@whatwg-node/node-fetch')
  const form = new FormData()
  form.set('value', 'expected')
  const valid = new Request('http://localhost/fixture', {
    method: 'POST',
    body: form,
  })
  assert.equal((await valid.formData()).get('value'), 'expected')
  const invalid = new Request('http://localhost/fixture', {
    method: 'POST',
    headers: { 'content-type': 'multipart/form-data; boundary=fixture' },
    body: 'incomplete',
  })
  await assert.rejects(invalid.formData())
})

for (const [label, boundary, partHeader] of [
  ['a 252-byte boundary', 'b'.repeat(252), ''],
  ['a __proto__ part header', 'fixture', '\r\n__proto__: local'],
  ['a constructor part header', 'fixture', '\r\nconstructor: local'],
]) {
  test(`the WHATWG fetch owner parses multipart input with ${label}`, async () => {
    const { Request } = await import('@whatwg-node/node-fetch')
    const request = new Request('http://localhost/fixture', {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body: `--${boundary}\r\nContent-Disposition: form-data; name="value"${partHeader}\r\n\r\nexpected\r\n--${boundary}--\r\n`,
      signal: AbortSignal.timeout(fixtureTimeoutMs),
    })
    assert.equal((await request.formData()).get('value'), 'expected')
  })
}

for (const [owner, ownerRequire] of undiciOwners) {
  const undici = ownerRequire('undici')

  test(`${owner} transport drops origin credentials on a cross-origin redirect`, async (context) => {
    const received = []
    const target = await listen(context, (request, response) => {
      received.push({
        authorization: request.headers.authorization,
        cookie: request.headers.cookie,
      })
      response.end('expected')
    })
    const source = await listen(context, (_request, response) => {
      response.writeHead(302, { location: `${target}/fixture` })
      response.end()
    })
    const response = await undici.fetch(`${source}/fixture`, {
      headers: {
        authorization: 'Fixture local-only',
        cookie: 'fixture=local-only',
      },
    })
    assert.equal(await response.text(), 'expected')
    assert.deepEqual(received, [
      { authorization: undefined, cookie: undefined },
    ])
  })

  test(`${owner} transport refuses duplicate WebSocket subprotocols before connecting`, () => {
    assert.throws(
      () => new undici.WebSocket('ws://127.0.0.1:1/fixture', ['same', 'same']),
    )
  })

  test(`${owner} transport fails the connection for an unrequested WebSocket subprotocol`, async (context) => {
    const server = createServer()
    server.on('upgrade', (request, socket) => {
      const accept = createHash('sha1')
        .update(
          `${request.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`,
        )
        .digest('base64')
      socket.end(
        `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nSec-WebSocket-Protocol: unrequested\r\n\r\n`,
      )
    })
    context.after(() => {
      server.closeAllConnections()
      server.close()
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const socket = new undici.WebSocket(
      `ws://127.0.0.1:${address.port}/fixture`,
    )
    const outcome = await new Promise((resolve) => {
      socket.addEventListener('open', () => resolve('open'))
      socket.addEventListener('error', () => resolve('error'))
    })
    assert.equal(outcome, 'error')
    assert.equal(socket.readyState, undici.WebSocket.CLOSED)
  })

  test(`${owner} transport rejects an over-encoded response that closes early`, async (context) => {
    const origin = await listen(context, (_request, response) => {
      response.socket.end(
        'HTTP/1.1 200 OK\r\nContent-Encoding: gzip, gzip, gzip, gzip, gzip, gzip\r\nContent-Length: 100\r\n\r\n',
      )
    })
    await assert.rejects(
      undici.fetch(`${origin}/fixture`, {
        signal: AbortSignal.timeout(fixtureTimeoutMs),
      }),
      (error) => /too many content-encodings/.test(error.cause?.message),
    )
    const healthy = await listen(context, (_request, response) =>
      response.end('expected'),
    )
    const response = await undici.fetch(`${healthy}/fixture`)
    assert.equal(await response.text(), 'expected')
  })

  test(`${owner} transport does not store a cross-origin redirect result under the first URL`, async (context) => {
    const hits = { source: 0, target: 0 }
    const target = await listen(context, (_request, response) => {
      hits.target += 1
      response.writeHead(200, { 'cache-control': 'public, max-age=60' })
      response.end('target body')
    })
    const source = await listen(context, (_request, response) => {
      hits.source += 1
      response.writeHead(302, {
        location: `${target.replace('127.0.0.1', 'localhost')}/fixture`,
      })
      response.end()
    })
    const dispatcher = new undici.Agent().compose(
      undici.interceptors.redirect({ maxRedirections: 1 }),
      undici.interceptors.cache({
        store: new undici.cacheStores.MemoryCacheStore(),
        type: 'shared',
      }),
    )
    context.after(() => dispatcher.destroy())
    for (const expectedSourceHits of [1, 2]) {
      const response = await undici.request(`${source}/fixture`, {
        dispatcher,
      })
      assert.equal(response.statusCode, 200)
      assert.equal(await response.body.text(), 'target body')
      assert.equal(hits.source, expectedSourceHits)
    }
  })

  test(`${owner} transport retains an explicit local TLS trust anchor`, async (context) => {
    const directory = await mkdtemp(join(tmpdir(), 'garden-local-tls-'))
    context.after(() => rm(directory, { recursive: true, force: true }))
    const keyPath = join(directory, 'key.pem')
    const certPath = join(directory, 'cert.pem')
    const configPath = join(directory, 'openssl.cnf')
    await writeFile(
      configPath,
      `[req]
prompt = no
distinguished_name = dn
x509_extensions = test_server
[dn]
CN = localhost
[test_server]
subjectAltName = DNS:localhost,IP:127.0.0.1
basicConstraints = critical,CA:TRUE
keyUsage = critical,digitalSignature,keyEncipherment,keyCertSign
extendedKeyUsage = serverAuth
`,
    )
    // The self-signed fixture exists only in this private temporary directory.
    const generated = spawnSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '1',
        '-keyout',
        keyPath,
        '-out',
        certPath,
        '-config',
        configPath,
      ],
      { timeout: fixtureTimeoutMs, maxBuffer: 65_536, encoding: 'utf8' },
    )
    assert.equal(generated.error, undefined)
    assert.equal(generated.status, 0, generated.stderr)
    await chmod(keyPath, 0o600)
    const [key, cert] = await Promise.all([
      readFile(keyPath),
      readFile(certPath),
    ])
    const origin = await listen(
      context,
      (_request, response) => response.end('trusted fixture'),
      { key, cert },
    )
    await assert.rejects(
      undici.fetch(origin, { signal: AbortSignal.timeout(fixtureTimeoutMs) }),
    )
    const dispatcher = new undici.Agent({
      connect: { ca: cert, rejectUnauthorized: true },
    })
    context.after(() => dispatcher.destroy())
    const response = await undici.fetch(origin, {
      dispatcher,
      signal: AbortSignal.timeout(fixtureTimeoutMs),
    })
    assert.equal(await response.text(), 'trusted fixture')
  })

  test(`${owner} transport reports refusal from a stopped local listener`, async () => {
    const server = createServer()
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
    await assert.rejects(
      undici.fetch(`http://127.0.0.1:${address.port}/fixture`, {
        signal: AbortSignal.timeout(fixtureTimeoutMs),
      }),
    )
    assert.equal(server.listening, false)
  })
}

{
  // Think 0.24 dropped its inspect CLI; wrangler remains the TOML/smol-toml owner.
  const { parse: parseToml } = wranglerRequire('smol-toml')

  test('the wrangler TOML owner parses a valid document', () => {
    const result = parseToml(
      'name = "local-parser-fixture"\ncompatibility_date = "2026-11-21"\n',
    )
    assert.equal(result.name, 'local-parser-fixture')
  })

  test('the wrangler TOML owner refuses incomplete input', () => {
    assert.throws(
      () => parseToml('name = [\n'),
      (error) =>
        error instanceof Error &&
        /Invalid TOML|unfinished array/i.test(error.message),
    )
  })
}

{
  // Every Garden DOCX read loads Mammoth, and Mammoth loads its own xmldom.
  // These checks exercise the patched copies that `patches/` installs (#449).
  const mammothRequire = createRequire(
    new URL('../packages/agent-runtime/package.json', import.meta.url),
  )
  const xmldomRequire = createRequire(mammothRequire.resolve('mammoth'))
  const mammothXml = xmldomRequire('./xml/xmldom.js')
  const { DOMImplementation, DOMParser } = xmldomRequire('@xmldom/xmldom')
  const { ParseError } = xmldomRequire('@xmldom/xmldom/lib/sax')

  const diagnostics = (xml) => {
    const reported = []
    new DOMParser({
      errorHandler: (level, message) => reported.push(`${level}: ${message}`),
    }).parseFromString(xml)
    return reported
  }

  test('the Mammoth XML reader parses valid markup with every node kind', () => {
    const document = mammothXml.parseFromString(
      '<?xml version="1.0"?><a b="1 &amp; 2"><?pi data?><!-- note --><![CDATA[<raw>]]>text &lt;x&gt;</a>',
    )
    assert.equal(document.documentElement.getAttribute('b'), '1 & 2')
    assert.equal(document.documentElement.textContent, '<raw>text <x>')
    assert.equal(document.documentElement.childNodes.length, 4)
  })

  test('the Mammoth XML reader stops at the first parser diagnostic', () => {
    // A recovering parse reports one diagnostic per malformed tag.
    const xml = `<a>${'<b c="'.repeat(4_000)}</a>`
    const [first, ...rest] = diagnostics(xml)
    assert.ok(rest.length > 4_000)
    assert.throws(
      () => mammothXml.parseFromString(xml),
      (error) => error instanceof ParseError && error.message === first,
    )
  })

  test('the Mammoth xmldom reports an unclosed processing instruction', () => {
    assert.match(
      diagnostics('<a><?pi data</a>')[0],
      /^error: .*Unclosed processing instruction/,
    )
    assert.deepEqual(diagnostics('<a><?pi data?></a>'), [])
  })

  test('the Mammoth xmldom reports an unclosed CDATA section', () => {
    assert.match(
      diagnostics('<a><![CDATA[data</a>')[0],
      /^error: .*Unclosed CDATA section/,
    )
    assert.deepEqual(diagnostics('<a><![CDATA[data]]></a>'), [])
  })

  test('the Mammoth xmldom merges text runs in normalize() in linear time', () => {
    const document = new DOMImplementation().createDocument(null, 'root', null)
    const parentWithRuns = (runs) => {
      const parent = document.createElement('p')
      for (let index = 0; index < runs; index += 1) {
        parent.appendChild(document.createTextNode('a'))
        parent.appendChild(document.createTextNode('b'))
        parent.appendChild(document.createElement('x'))
      }
      return parent
    }
    // The fastest of three runs filters scheduler noise from each size.
    const normalizeMs = (runs) =>
      Math.min(
        ...[0, 1, 2].map(() => {
          const parent = parentWithRuns(runs)
          const started = performance.now()
          parent.normalize()
          return performance.now() - started
        }),
      )

    const merged = parentWithRuns(3)
    merged.normalize()
    assert.equal(merged.childNodes.length, 6)
    assert.equal(merged.childNodes[4].data, 'ab')
    assert.equal(merged.childNodes[5].tagName, 'x')
    assert.equal(merged.lastChild, merged.childNodes[5])

    // Eight times the runs costs about eight times the work when linear and
    // about 64 times when quadratic. Unpatched 0.8.15 measured over 100 times.
    normalizeMs(2_000)
    const ratio = normalizeMs(16_000) / Math.max(normalizeMs(2_000), 0.5)
    assert.ok(
      ratio < 32,
      `normalize() scaled ${ratio.toFixed(1)}x for 8x input`,
    )
  })
}
