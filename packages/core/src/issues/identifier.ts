export function deriveIssuePrefix(name: string): string {
  const stripped = name.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const base = stripped.length > 0 ? stripped.slice(0, 3) : 'ISS'
  return base.padEnd(2, 'X').slice(0, 8)
}

export function formatIssueIdentifier(prefix: string, number: number): string {
  return `${prefix}-${number}`
}
