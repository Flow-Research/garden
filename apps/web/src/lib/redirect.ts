const SAME_ORIGIN_BASE = 'https://garden.invalid'

function hasControlCharacter(value: string) {
  return [...value].some((char) => char.charCodeAt(0) < 0x20)
}

/**
 * Returns `target` only when it is a path on this origin. Browsers treat `\` as
 * `/` and drop tabs and newlines, so `/\evil.com` or `/\t/evil.com` would
 * otherwise slip past a plain `//` check and leave the site. The target is
 * resolved against a fixed base and must keep that origin.
 */
export function sanitizeRedirectTarget(target: unknown, fallback = '/home') {
  if (
    typeof target !== 'string' ||
    !target.startsWith('/') ||
    target.startsWith('//') ||
    target.includes('\\') ||
    hasControlCharacter(target)
  ) {
    return fallback
  }

  let resolved: URL
  try {
    resolved = new URL(target, SAME_ORIGIN_BASE)
  } catch {
    return fallback
  }
  if (resolved.origin !== SAME_ORIGIN_BASE) return fallback

  return `${resolved.pathname}${resolved.search}${resolved.hash}`
}
