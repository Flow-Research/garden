import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CHECKS, exitCode, formatResult, runCheck } from './smoke.mjs'

const byName = (name) => CHECKS.find((c) => c.name === name)
const fakeFetch =
  (status, body, contentType = 'application/json') =>
  async () =>
    new Response(body, { status, headers: { 'content-type': contentType } })

test('health passes on 200 status ok and fails on 404', async () => {
  const ok = await runCheck(byName('health'), {
    baseUrl: 'http://x',
    fetchImpl: fakeFetch(200, '{"status":"ok"}'),
  })
  assert.equal(ok.outcome, 'PASS')
  const missing = await runCheck(byName('health'), {
    baseUrl: 'http://x',
    fetchImpl: fakeFetch(404, 'nope', 'text/html'),
  })
  assert.equal(missing.outcome, 'FAIL')
  assert.equal(missing.status, 404)
})

test('network error is a FAIL with no status', async () => {
  const r = await runCheck(byName('health'), {
    baseUrl: 'http://x',
    fetchImpl: async () => Promise.reject(new Error('ECONNREFUSED')),
  })
  assert.deepEqual(
    [r.outcome, r.status, r.detail],
    ['FAIL', null, 'ECONNREFUSED'],
  )
})

test('authenticated checks skip without a cookie and send it when set', async () => {
  const skipped = await runCheck(byName('issues list'), {
    baseUrl: 'http://x',
    cookie: '',
  })
  assert.equal(skipped.outcome, 'SKIPPED')
  let sent
  await runCheck(byName('issues list'), {
    baseUrl: 'http://x',
    cookie: 'secret=1',
    fetchImpl: async (_url, init) => (
      (sent = init.headers.cookie), new Response('{}', { status: 200 })
    ),
  })
  assert.equal(sent, 'secret=1')
})

test('authenticated checks are GET only', () => {
  assert.ok(
    CHECKS.filter((c) => c.auth).every((c) => (c.method ?? 'GET') === 'GET'),
  )
})

test('exit code fails on FAIL, and on SKIPPED only when auth is required', () => {
  const skip = [{ outcome: 'PASS' }, { outcome: 'SKIPPED' }]
  assert.equal(exitCode(skip, false), 0)
  assert.equal(exitCode(skip, true), 1)
  assert.equal(exitCode([{ outcome: 'FAIL' }], false), 1)
})

test('formatted line never contains the cookie', () => {
  const line = formatResult({
    name: 'me',
    outcome: 'PASS',
    status: 200,
    ms: 5,
    detail: null,
  })
  assert.ok(!line.includes('secret'))
})
