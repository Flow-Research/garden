/**
 * Team chip colors use existing util token vars (resolved by CSS in both
 * themes) and a deterministic hash so the same Team always renders the same
 * dot without storing a color in the database.
 */
const TEAM_COLOR_TOKENS = [
  'var(--util-color-10)',
  'var(--util-color-11)',
  'var(--util-color-14)',
  'var(--util-color-1)',
] as const

export function teamColor(teamId: string): string {
  let hash = 0
  for (let index = 0; index < teamId.length; index += 1) {
    hash = (hash * 31 + teamId.charCodeAt(index)) >>> 0
  }
  return TEAM_COLOR_TOKENS[hash % TEAM_COLOR_TOKENS.length]
}
