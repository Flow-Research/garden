export type ConnectorError =
  | { kind: 'transient'; retryable: true; detail: string }
  | { kind: 'auth_expired'; reconnect_url: string }
  | { kind: 'permission_denied'; required_scope?: string }
  | { kind: 'rate_limited'; retry_after_ms?: number }
  | { kind: 'not_found'; external_ref: string }
  | { kind: 'unknown'; raw: unknown }

function objectOrNull(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const parsed = Number(value.trim())
  return Number.isFinite(parsed) ? parsed : null
}

function knownConnectorError(
  value: Record<string, unknown>,
): ConnectorError | null {
  switch (value.kind) {
    case 'transient':
      return {
        kind: 'transient',
        retryable: true,
        detail: stringValue(value.detail) ?? 'Transient connector failure',
      }
    case 'auth_expired':
      return {
        kind: 'auth_expired',
        reconnect_url:
          stringValue(value.reconnect_url) ?? '/settings/connections',
      }
    case 'permission_denied':
      return {
        kind: 'permission_denied',
        ...(stringValue(value.required_scope)
          ? { required_scope: stringValue(value.required_scope)! }
          : {}),
      }
    case 'rate_limited':
      return {
        kind: 'rate_limited',
        ...(numberValue(value.retry_after_ms) !== null
          ? { retry_after_ms: numberValue(value.retry_after_ms)! }
          : {}),
      }
    case 'not_found':
      return {
        kind: 'not_found',
        external_ref: stringValue(value.external_ref) ?? 'external object',
      }
    case 'unknown':
      return { kind: 'unknown', raw: value.raw }
    default:
      return null
  }
}

function gardenMeta(value: unknown) {
  const meta = objectOrNull(objectOrNull(value)?._meta)
  return objectOrNull(meta?.garden)
}

function messageFromCause(cause: unknown) {
  if (cause instanceof Error) return cause.message
  const object = objectOrNull(cause)
  return (
    stringValue(object?.message) ??
    stringValue(object?.error) ??
    stringValue(object?.detail) ??
    String(cause)
  )
}

export function classifyConnectorError(cause: unknown): ConnectorError {
  const object = objectOrNull(cause)
  const known = object ? knownConnectorError(object) : null
  if (known) return known

  const meta = gardenMeta(cause)
  const code =
    stringValue(meta?.code) ??
    stringValue(object?.code) ??
    stringValue(object?.error_code)
  const message = messageFromCause(cause)
  const lower = message.toLowerCase()
  const status =
    numberValue(object?.status) ??
    numberValue(object?.statusCode) ??
    numberValue(object?.status_code)

  if (
    code === 'reauth_required' ||
    status === 401 ||
    lower.includes('expired')
  ) {
    return { kind: 'auth_expired', reconnect_url: '/settings/connections' }
  }

  if (
    code === 'permission_error' ||
    code === 'unclassified_tool' ||
    status === 403 ||
    lower.includes('permission') ||
    lower.includes('forbidden')
  ) {
    return {
      kind: 'permission_denied',
      ...((stringValue(meta?.requiredScope) ??
      stringValue(meta?.required_scope))
        ? {
            required_scope:
              stringValue(meta?.requiredScope) ??
              stringValue(meta?.required_scope) ??
              undefined,
          }
        : {}),
    }
  }

  if (
    code === 'rate_limited' ||
    status === 429 ||
    lower.includes('rate limit') ||
    lower.includes('too many requests')
  ) {
    return {
      kind: 'rate_limited',
      ...((numberValue(meta?.retryAfterMs) ?? numberValue(meta?.retry_after_ms))
        ? {
            retry_after_ms:
              numberValue(meta?.retryAfterMs) ??
              numberValue(meta?.retry_after_ms) ??
              undefined,
          }
        : {}),
    }
  }

  if (status === 404 || lower.includes('not found')) {
    return { kind: 'not_found', external_ref: message }
  }

  if (
    status === 408 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    lower.includes('timeout') ||
    lower.includes('temporarily unavailable')
  ) {
    return { kind: 'transient', retryable: true, detail: message }
  }

  return { kind: 'unknown', raw: cause }
}
