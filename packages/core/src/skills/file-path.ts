type SupportingFilePath = { kind: 'valid'; path: string } | { kind: 'invalid' }

/**
 * Gives bundle validation and the Add file dialog one path identity. Previously
 * dot and empty segments bypassed duplicate and reserved SKILL.md checks.
 * Reject roots and parent traversal before removing harmless path segments.
 */
export function parseSupportingFilePath(input: string): SupportingFilePath {
  const normalized = input.trim().replace(/\\/g, '/')
  const segments = normalized.split('/')
  if (normalized.startsWith('/') || segments.includes('..')) {
    return { kind: 'invalid' }
  }
  const path = segments
    .filter((segment) => segment !== '' && segment !== '.')
    .join('/')
  if (!path || path.toLowerCase() === 'skill.md') {
    return { kind: 'invalid' }
  }
  return { kind: 'valid', path }
}
