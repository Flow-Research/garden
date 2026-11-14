#!/usr/bin/env node
/**
 * Read-only smoke suite for a deployed Garden Worker (FLO-32).
 *
 * Before: a deploy could only be checked with one `curl` against
 * `/api/health` and by signing in by hand. After: `pnpm smoke` runs public
 * checks (health, sign-in page, webhook signature rejection, session guard)
 * and, when `SMOKE_SESSION_COOKIE` is set, authenticated list GETs. Every
 * request is a GET except the webhook probe, which sends an empty body with a
 * bogus signature; the route verifies the signature before it reads or writes
 * anything, so the probe has no side effects.
 *
 * Env:
 * - `SMOKE_BASE_URL` (default staging workers.dev origin)
 * - `SMOKE_SESSION_COOKIE` full Cookie header value; never printed
 * - `SMOKE_REQUIRE_AUTH=1` makes skipped authenticated checks fail the run
 *
 * References: `docs/guides/operate/deploy.md`, `apps/web/src/routes/api/**`.
 */
import { pathToFileURL } from 'node:url'

/** garden-dev holds the GitHub webhook and is the stabilisation target until Sprint 1 ends; staging follows. */
export const DEFAULT_BASE_URL = 'https://garden-dev.flow-research.workers.dev'

/** @typedef {{ status: number, contentType: string, json: unknown }} SmokeResponse  `json` is undefined when the body is not JSON. */
/** @typedef {{ name: string, auth: boolean, method?: string, path: string, headers?: Record<string,string>, expect: (res: SmokeResponse) => string | null }} SmokeCheck */
/** @typedef {{ name: string, outcome: 'PASS' | 'FAIL' | 'SKIPPED', status: number | null, ms: number, detail: string | null }} SmokeResult */

/** Returns an error message unless the response status is one of `allowed`. */
const statusIn =
  (...allowed) =>
  (res) =>
    allowed.includes(res.status)
      ? null
      : `expected ${allowed.join('/')}, got ${res.status}`

/** Returns the first failure from `checks`, or null when all pass. */
const all =
  (...checks) =>
  (res) =>
    checks.map((check) => check(res)).find((error) => error !== null) ?? null

const isHtml = (res) =>
  res.contentType.includes('text/html')
    ? null
    : `expected HTML, got ${res.contentType || 'no content-type'}`

const jsonField = (field, value) => (res) =>
  res.json?.[field] === value
    ? null
    : `expected body.${field} === ${JSON.stringify(value)}`

const isJson = (res) => (res.json === undefined ? 'expected JSON body' : null)

/** @type {SmokeCheck[]} */
export const CHECKS = [
  {
    name: 'health',
    auth: false,
    path: '/api/health',
    expect: all(statusIn(200), jsonField('status', 'ok')),
  },
  {
    name: 'sign-in page',
    auth: false,
    path: '/login',
    expect: all(statusIn(200), isHtml),
  },
  {
    name: 'github webhook rejects bad signature',
    auth: false,
    method: 'POST',
    path: '/api/github/webhook',
    headers: { 'x-hub-signature-256': 'sha256=00' },
    expect: statusIn(401, 403),
  },
  {
    name: 'me requires session',
    auth: false,
    path: '/api/me',
    expect: statusIn(401),
  },
  {
    name: 'me',
    auth: true,
    path: '/api/me',
    expect: all(statusIn(200), isJson),
  },
  {
    name: 'workspaces',
    auth: true,
    path: '/api/workspaces',
    expect: all(statusIn(200), isJson),
  },
  {
    name: 'issues list',
    auth: true,
    path: '/api/issues',
    expect: all(statusIn(200), isJson),
  },
  {
    name: 'automations list',
    auth: true,
    path: '/api/automations',
    expect: all(statusIn(200), isJson),
  },
  {
    name: 'org brain files',
    auth: true,
    path: '/api/brain/files',
    expect: all(statusIn(200), isJson),
  },
  {
    name: 'chat threads',
    auth: true,
    path: '/api/chat/threads',
    expect: all(statusIn(200), isJson),
  },
]

/**
 * Runs one check. Network errors become a FAIL result instead of a thrown
 * error so one unreachable route never hides the other results.
 * @returns {Promise<SmokeResult>}
 */
export async function runCheck(check, { baseUrl, cookie, fetchImpl = fetch }) {
  if (check.auth && !cookie) {
    return {
      name: check.name,
      outcome: 'SKIPPED',
      status: null,
      ms: 0,
      detail: 'SMOKE_SESSION_COOKIE not set',
    }
  }
  const started = performance.now()
  const headers = { ...check.headers, ...(check.auth ? { cookie } : {}) }
  const response = await fetchImpl(new URL(check.path, baseUrl), {
    method: check.method ?? 'GET',
    headers,
    body: check.method === 'POST' ? '' : undefined,
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  }).then(
    async (res) => ({
      status: res.status,
      contentType: res.headers.get('content-type') ?? '',
      json: await res.json().then(
        (value) => value,
        () => undefined,
      ),
    }),
    (cause) => ({ error: describeFetchError(cause) }),
  )
  const ms = Math.round(performance.now() - started)
  if ('error' in response) {
    return {
      name: check.name,
      outcome: 'FAIL',
      status: null,
      ms,
      detail: response.error,
    }
  }
  const detail = check.expect(response)
  return {
    name: check.name,
    outcome: detail === null ? 'PASS' : 'FAIL',
    status: response.status,
    ms,
    detail,
  }
}

/** Undici wraps the real reason (ECONNREFUSED, ENOTFOUND) in `cause`. */
function describeFetchError(error) {
  const code = error?.cause?.code ?? error?.cause?.errors?.[0]?.code
  const message = error instanceof Error ? error.message : String(error)
  return code ? `${message} (${code})` : message
}

/** Formats one result line. Never includes request headers. */
export const formatResult = (r) =>
  `${r.outcome.padEnd(7)} ${r.name.padEnd(38)} ${String(r.status ?? '-').padEnd(4)} ${String(r.ms).padStart(5)}ms${r.detail ? `  ${r.detail}` : ''}`

/** Exit code: 1 on any FAIL, or on any SKIPPED when auth is required. */
export const exitCode = (results, requireAuth) =>
  results.some(
    (r) => r.outcome === 'FAIL' || (requireAuth && r.outcome === 'SKIPPED'),
  )
    ? 1
    : 0

/** Runs every check in order and prints one line each. */
export async function main(env = process.env) {
  const baseUrl = env.SMOKE_BASE_URL || DEFAULT_BASE_URL
  const cookie = env.SMOKE_SESSION_COOKIE || ''
  process.stdout.write(
    `smoke ${baseUrl} (auth: ${cookie ? 'session cookie set' : 'none'})\n`,
  )
  const results = []
  for (const check of CHECKS) {
    const result = await runCheck(check, { baseUrl, cookie })
    process.stdout.write(`${formatResult(result)}\n`)
    results.push(result)
  }
  return exitCode(results, env.SMOKE_REQUIRE_AUTH === '1')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await main()
}
