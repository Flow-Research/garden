export const SKILL_COMMAND = '/'

// Slash command menu fires when the user is typing `/` followed by
// an optional slug. The committed invocation format is the same direct
// token the user typed, e.g. `/pdf`, so selected skills stay readable.
const SKILL_TRIGGER_PATTERN = /(?:^|\s)\/([a-zA-Z0-9_-]*)$/
const SLASH_SKILL_TOKEN_PATTERN = /^\/([a-zA-Z0-9_-]+)$/

export type SkillTriggerMatch = {
  query: string
  rangeStart: number
  rangeEnd: number
}

export function formatSkillInvocation(slug: string) {
  return `${SKILL_COMMAND}${slug}`
}

export function detectSkillTrigger(
  input: string,
  cursor: number,
): SkillTriggerMatch | null {
  const prefix = input.slice(0, cursor)
  const match = SKILL_TRIGGER_PATTERN.exec(prefix)
  if (!match) return null

  const query = match[1] ?? ''
  // The captured command is `/` + query; its length is query.length + 1.
  const rangeStart = prefix.length - (query.length + 1)

  return {
    query,
    rangeStart,
    rangeEnd: cursor,
  }
}

export function extractExplicitSkillSlugs(input: string) {
  const slugs = input
    .split(/\s+/)
    .flatMap((token) => SLASH_SKILL_TOKEN_PATTERN.exec(token)?.[1] ?? [])

  return Array.from(new Set(slugs))
}

export function stripExplicitSkills(input: string): {
  slugs: string[]
  cleaned: string
} {
  const slugs = extractExplicitSkillSlugs(input)
  const cleaned = input
    .split(/\s+/)
    .filter((token) => !SLASH_SKILL_TOKEN_PATTERN.test(token))
    .join(' ')
    .trim()
  return { slugs, cleaned }
}
