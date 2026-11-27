import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { fromJSON, toJSON, toJSONAsync, createPlugin } from 'seroval'

const require = createRequire(import.meta.url)
const proxyaddr = require('proxy-addr')
const { quote } = require('shell-quote')

test('Seroval retains ordinary structured values and settled promises', async () => {
  const value = {
    date: new Date('2026-11-21T00:00:00Z'),
    map: new Map([['key', 7]]),
    set: new Set(['value']),
  }
  assert.deepEqual(fromJSON(toJSON(value)), value)
  const promise = fromJSON(
    await toJSONAsync(Promise.resolve({ value: 'ready' })),
  )
  assert.deepEqual(await promise, { value: 'ready' })
})

test('Seroval refuses plugin-produced then-callables without invoking them', async () => {
  class Marker {}
  let calls = 0
  const plugin = createPlugin({
    tag: 'garden/security-test/callable',
    test: (value) => value instanceof Marker,
    parse: { async: async () => ({}), sync: () => ({}) },
    serialize: () => {
      throw new Error('Source serialization is outside this test')
    },
    deserialize: () => () => {
      calls++
    },
  })
  // The fixture deliberately becomes a then-callable only after deserialization.
  // oxlint-disable-next-line unicorn/no-thenable
  const payload = await toJSONAsync(Promise.resolve({ then: new Marker() }), {
    plugins: [plugin],
  })
  assert.throws(() => fromJSON(payload, { plugins: [plugin] }))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(calls, 0)
})

test('IPv6 trust ranges cannot grant all IPv4 clients proxy trust', () => {
  for (const subnet of ['::ffff:10.0.0.0/8', '::/1']) {
    const trust = proxyaddr.compile(subnet)
    assert.equal(trust('203.0.113.10', 0), false)
    const request = {
      socket: { remoteAddress: '203.0.113.10' },
      headers: { 'x-forwarded-for': '127.0.0.1' },
    }
    assert.equal(proxyaddr(request, trust), '203.0.113.10')
  }
  const trust = proxyaddr.compile('::ffff:10.0.0.0/104')
  assert.equal(trust('10.1.2.3', 0), true)
  assert.equal(trust('203.0.113.10', 0), false)
})

test('Shell quoting rejects a line terminator after a comment without running a shell', () => {
  for (const newline of ['\n', '\r', '\u2028', '\u2029']) {
    assert.throws(
      () =>
        quote(['echo', 'ok', { comment: 'x' }, `a${newline}untrusted-text;#`]),
      TypeError,
    )
  }
  assert.equal(quote(['echo', 'two words']), "echo 'two words'")
})
