/**
 * Entity chip colors use existing util token vars (resolved by CSS in both
 * themes) and a deterministic hash so the same Team or project always renders
 * the same dot without storing a color in the database.
 */
const HASH_COLOR_TOKENS = [
  'var(--util-color-10)',
  'var(--util-color-11)',
  'var(--util-color-14)',
  'var(--util-color-1)',
] as const

export function hashColor(id: string): string {
  let hash = 0
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0
  }
  return HASH_COLOR_TOKENS[hash % HASH_COLOR_TOKENS.length]
}

/** Team chip dot color. Thin alias over the shared hash. */
export function teamColor(teamId: string): string {
  return hashColor(teamId)
}
