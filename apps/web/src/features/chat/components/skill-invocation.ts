export const SKILL_COMMAND = '/skill'

// Slash command menu fires when the user is typing `/` followed by
// an optional slug. We keep the `/skill <slug>` invocation format on
// insertion so the runtime parser stays unchanged.
const SKILL_TRIGGER_PATTERN = /(?:^|\s)\/([a-zA-Z0-9_-]*)$/
const EXPLICIT_SKILL_PATTERN = /(?:^|\s)\/skill\s+([a-zA-Z0-9_-]+)/g

export type SkillTriggerMatch = {
  query: string
  rangeStart: number
  rangeEnd: number
}

export function formatSkillInvocation(slug: string) {
  return `${SKILL_COMMAND} ${slug}`
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
  return Array.from(
    new Set(
      Array.from(input.matchAll(EXPLICIT_SKILL_PATTERN)).flatMap((match) =>
        match[1] ? [match[1]] : [],
      ),
    ),
  )
}
