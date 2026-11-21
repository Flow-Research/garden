import assert from 'node:assert/strict'
import { once } from 'node:events'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createServer as createSecureServer } from 'node:https'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

// Use the existing web fixture deadline for child and local transport checks.
const fixtureTimeoutMs = 120_000
const sdkRequire = createRequire(
  import.meta.resolve('@modelcontextprotocol/sdk/server/streamableHttp.js'),
)
const expressRequire = createRequire(sdkRequire.resolve('express'))
const codemodeRequire = createRequire(
  import.meta.resolve('@executor-js/codemode-core'),
)
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

for (const [label, text, parsed] of [
  [
    'valid',
    'name = "local-parser-fixture"\ncompatibility_date = "2026-11-21"\n',
    true,
  ],
  ['incomplete', 'name = [\n', false],
]) {
  test(`Think inspect reports ${label} TOML through its actual project reader`, async (context) => {
    const directory = await mkdtemp(join(tmpdir(), 'garden-parser-config-'))
    context.after(() => rm(directory, { recursive: true, force: true }))
    await writeFile(join(directory, 'wrangler.toml'), text)
    const entry = fileURLToPath(
      new URL('./cli/index.js', import.meta.resolve('@cloudflare/think')),
    )
    const child = spawnSync(
      process.execPath,
      [entry, 'inspect', '--root', directory, '--json'],
      {
        timeout: fixtureTimeoutMs,
        maxBuffer: 65_536,
        encoding: 'utf8',
      },
    )
    assert.equal(child.error, undefined)
    assert.equal(child.status, 0, child.stderr)
    const result = JSON.parse(child.stdout)
    assert.equal(result.wranglerConfig.parsed, parsed)
    if (parsed) {
      assert.equal(result.wranglerConfig.error, undefined)
      assert.equal(result.workerConfig.name, 'local-parser-fixture')
    } else assert.equal(typeof result.wranglerConfig.error, 'string')
  })
}
