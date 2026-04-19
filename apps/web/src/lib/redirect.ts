export function sanitizeRedirectTarget(
  target: unknown,
  fallback = '/workspace',
) {
  if (
    typeof target !== 'string' ||
    !target.startsWith('/') ||
    target.startsWith('//')
  ) {
    return fallback
  }

  return target
}
