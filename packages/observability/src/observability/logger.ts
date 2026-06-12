export type GardenLogLevel = 'debug' | 'info' | 'warn' | 'error'

export type GardenLogFields = Record<string, unknown>

export type GardenLoggerOptions = {
  service: string
  component: string
  environment?: string | null
  base?: GardenLogFields
  diagnosticsChannel?: boolean
}

export type GardenLogger = {
  debug: (event: string, fields?: GardenLogFields) => void
  info: (event: string, fields?: GardenLogFields) => void
  warn: (event: string, fields?: GardenLogFields) => void
  error: (event: string, fields?: GardenLogFields) => void
  child: (fields: GardenLogFields) => GardenLogger
}

const SCHEMA_VERSION = 1
const SOURCE = 'garden'
const REDACTED = '[redacted]'
const MAX_STRING_LENGTH = 2_000
const MAX_ARRAY_LENGTH = 25
const MAX_DEPTH = 5

const SECRET_KEY_PATTERN =
  /authorization|cookie|token|secret|password|passwd|private.?key|api.?key|client.?secret|database.?url|connection.?string|session/i

const SECRET_VALUE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /\bcf[a-z0-9_-]{16,}\b/gi,
  /\b(?:postgres|postgresql|mysql|mongodb|redis|amqp)(?:ql)?:\/\/[^\s]+/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /(__Secure-)?better-auth[.-]session_token=[^;\s]+/gi,
  /(params:\s*)[A-Za-z0-9._~+/=-]{16,}/gi,
]

const CONSOLE_METHOD: Record<GardenLogLevel, 'debug' | 'info' | 'warn' | 'error'> = {
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error',
}
const LOG_LEVEL_PRIORITY: Record<GardenLogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

let configuredGardenLogLevel: GardenLogLevel | null = null

/**
 * Applies the Worker-provided Garden log threshold to every logger instance.
 * Before this gate, local dev printed every info/debug lifecycle record because
 * `console.info` and `console.debug` are always visible in Wrangler/Vite. After
 * binding `GARDEN_LOG_LEVEL`, high-volume success logs can be hidden while warn
 * and error records remain visible. Reference: Cloudflare Sandbox SDK's
 * `SANDBOX_LOG_LEVEL` pattern verified in docs and installed source.
 */
export function setGardenLogLevel(level: GardenLogLevel | null | undefined) {
  configuredGardenLogLevel = normalizeLogLevel(level)
}

function normalizeLogLevel(value: unknown): GardenLogLevel | null {
  return value === 'debug' ||
    value === 'info' ||
    value === 'warn' ||
    value === 'error'
    ? value
    : null
}

function processGardenLogLevel() {
  const processEnv = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process?.env
  return normalizeLogLevel(processEnv?.GARDEN_LOG_LEVEL)
}

function activeGardenLogLevel() {
  return configuredGardenLogLevel ?? processGardenLogLevel() ?? 'info'
}

function shouldEmitLogLevel(level: GardenLogLevel) {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[activeGardenLogLevel()]
}

/**
 * Creates the Cloudflare-native Garden logger. Cloudflare Workers Logs indexes
 * object logs directly, and Tail Workers receive those log objects after the
 * producer invocation. Keeping the logger as a tiny JSON console publisher gives
 * Garden request/run/user correlation without dragging Node-oriented transports
 * like Pino into Workers. References consulted: Cloudflare Workers structured
 * JSON logging docs and Tail Worker docs.
 */
export function createGardenLogger(
  options: GardenLoggerOptions,
): GardenLogger {
  const base = normalizeFields(options.base ?? {})

  const emit = (level: GardenLogLevel, event: string, fields?: GardenLogFields) => {
    if (!shouldEmitLogLevel(level)) return

    const record = normalizeFields({
      source: SOURCE,
      schemaVersion: SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      level,
      service: options.service,
      component: options.component,
      ...(options.environment ? { environment: options.environment } : {}),
      ...base,
      event,
      message: event,
      ...fields,
    })

    console[CONSOLE_METHOD[level]](record)
  }

  return {
    debug: (event, fields) => emit('debug', event, fields),
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
    child: (fields) =>
      createGardenLogger({
        ...options,
        base: {
          ...base,
          ...normalizeFields(fields),
        },
      }),
  }
}

export function errorFields(error: unknown) {
  return errorFieldsAtDepth(error, 0)
}

/**
 * Preserves actionable exception context for Worker logs without exposing
 * secrets. Before this helper only emitted name/message/stack, so wrapped
 * Better Result, RPC, HTTP, AggregateError, and `cause` failures lost the fields
 * needed to debug opaque framework errors. After this helper, all logging sites
 * automatically keep sanitized custom fields plus bounded nested causes.
 */
function errorFieldsAtDepth(error: unknown, depth: number): GardenLogFields {
  if (error instanceof Error) {
    const output: GardenLogFields = {
      errorName: error.name,
      errorMessage: redactString(error.message),
      errorStack: error.stack ? redactString(error.stack) : undefined,
      ...errorCustomFields(error, depth),
    }

    const cause = (error as Error & { cause?: unknown }).cause
    if (cause !== undefined) {
      output.errorCause =
        depth >= 2 ? '[max-depth]' : errorFieldsAtDepth(cause, depth + 1)
    }

    const aggregateErrors = (error as Error & { errors?: unknown }).errors
    if (Array.isArray(aggregateErrors)) {
      output.errorErrors = aggregateErrors
        .slice(0, 5)
        .map((entry) => errorFieldsAtDepth(entry, depth + 1))
    }

    return output
  }

  return {
    errorMessage: redactValue(error, depth),
  }
}

function errorCustomFields(error: Error, depth: number): GardenLogFields {
  const custom: GardenLogFields = {}
  const record = error as Error & Record<string, unknown>

  for (const key of ['code', 'status', 'statusCode', 'type', 'retryable']) {
    const value = record[key]
    if (value !== undefined) {
      custom[`error${key.charAt(0).toUpperCase()}${key.slice(1)}`] =
        redactValue(value, depth + 1)
    }
  }

  for (const [key, value] of Object.entries(record)) {
    if (
      key === 'name' ||
      key === 'message' ||
      key === 'stack' ||
      key === 'cause' ||
      key === 'errors'
    ) {
      continue
    }
    if (custom[`error${key.charAt(0).toUpperCase()}${key.slice(1)}`] !== undefined) {
      continue
    }
    const redacted = SECRET_KEY_PATTERN.test(key)
      ? REDACTED
      : redactValue(value, depth + 1)
    if (redacted !== undefined) {
      custom[`error${key.charAt(0).toUpperCase()}${key.slice(1)}`] = redacted
    }
  }

  return custom
}

export function requestFields(request: Request) {
  const url = new URL(request.url)
  const cfRay = request.headers.get('cf-ray')
  const requestId =
    request.headers.get('x-garden-request-id') ??
    request.headers.get('x-request-id') ??
    cfRay ??
    crypto.randomUUID()

  return {
    requestId,
    cfRay,
    method: request.method,
    path: url.pathname,
  }
}

export function responseFields(response: Response, startedAt: number) {
  return {
    status: response.status,
    durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
  }
}

/**
 * Adds Garden request correlation to ordinary HTTP responses without touching
 * protocol-switching responses. Before this guard, agent WebSocket handshakes
 * came back with status 101, and rebuilding them through the Fetch `Response`
 * constructor threw `RangeError: Responses may only be constructed with status
 * codes in the range 200 to 599`. After this guard, WebSocket upgrade responses
 * pass through unchanged while normal responses keep the request id header.
 * Reference checked: Cloudflare Workers response handling / WebSocket responses.
 */
export function withRequestIdHeader(response: Response, requestId: string) {
  if (response.status < 200 || response.status > 599) return response

  const headers = new Headers(response.headers)
  headers.set('x-garden-request-id', requestId)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function normalizeFields(fields: GardenLogFields): GardenLogFields {
  const normalized: GardenLogFields = {}
  for (const [key, value] of Object.entries(fields)) {
    const redacted = SECRET_KEY_PATTERN.test(key)
      ? REDACTED
      : redactValue(value, 0)
    if (redacted !== undefined) normalized[key] = redacted
  }
  return normalized
}

function redactValue(value: unknown, depth: number): unknown {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value === 'string') return redactString(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Error) return errorFields(value)
  if (depth >= MAX_DEPTH) return '[max-depth]'

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_LENGTH)
      .map((entry) => redactValue(entry, depth + 1))
  }

  if (typeof value === 'object') {
    const output: GardenLogFields = {}
    for (const [key, entry] of Object.entries(value)) {
      const redacted = SECRET_KEY_PATTERN.test(key)
        ? REDACTED
        : redactValue(entry, depth + 1)
      if (redacted !== undefined) output[key] = redacted
    }
    return output
  }

  return String(value)
}

function redactString(value: string) {
  const clipped =
    value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}…[truncated]`
      : value

  return SECRET_VALUE_PATTERNS.reduce((next, pattern) => {
    if (pattern.source.startsWith('(params:')) {
      return next.replace(pattern, '$1[redacted]')
    }
    return next.replace(pattern, REDACTED)
  }, clipped)
}
