import type { ComposerSkill } from '../chat-runtime-provider'

type RankedSkill = {
  skill: ComposerSkill
  score: number
  tieBreaker: string
}

function normalizeSkillQuery(query: string) {
  return query.trim().replace(/^\/+/, '').toLowerCase()
}

function lengthPenalty(value: string, query: string) {
  return Math.min(64, Math.max(0, value.length - query.length))
}

function findBoundaryMatchIndex(value: string, query: string) {
  let bestIndex: number | null = null

  for (const marker of [' ', '-', '_', '/']) {
    const index = value.indexOf(`${marker}${query}`)
    if (index === -1) continue

    const matchIndex = index + marker.length
    if (bestIndex === null || matchIndex < bestIndex) {
      bestIndex = matchIndex
    }
  }

  return bestIndex
}

function scoreSubsequenceMatch(value: string, query: string) {
  if (!query) return 0

  let queryIndex = 0
  let firstMatchIndex = -1
  let previousMatchIndex = -1
  let gapPenalty = 0

  for (let valueIndex = 0; valueIndex < value.length; valueIndex += 1) {
    if (value[valueIndex] !== query[queryIndex]) continue

    if (firstMatchIndex === -1) {
      firstMatchIndex = valueIndex
    }
    if (previousMatchIndex !== -1) {
      gapPenalty += valueIndex - previousMatchIndex - 1
    }

    previousMatchIndex = valueIndex
    queryIndex += 1
    if (queryIndex === query.length) {
      const spanPenalty = valueIndex - firstMatchIndex + 1 - query.length
      return (
        firstMatchIndex * 2 +
        gapPenalty * 3 +
        spanPenalty +
        lengthPenalty(value, query)
      )
    }
  }

  return null
}

function scoreQueryMatch(input: {
  value: string
  query: string
  exactBase: number
  prefixBase?: number
  boundaryBase?: number
  includesBase?: number
  fuzzyBase?: number
}) {
  const { value, query } = input
  if (!value || !query) return null

  if (value === query) return input.exactBase

  if (input.prefixBase !== undefined && value.startsWith(query)) {
    return input.prefixBase + lengthPenalty(value, query)
  }

  if (input.boundaryBase !== undefined) {
    const boundaryIndex = findBoundaryMatchIndex(value, query)
    if (boundaryIndex !== null) {
      return (
        input.boundaryBase + boundaryIndex * 2 + lengthPenalty(value, query)
      )
    }
  }

  if (input.includesBase !== undefined) {
    const includesIndex = value.indexOf(query)
    if (includesIndex !== -1) {
      return (
        input.includesBase + includesIndex * 2 + lengthPenalty(value, query)
      )
    }
  }

  if (input.fuzzyBase !== undefined) {
    const fuzzyScore = scoreSubsequenceMatch(value, query)
    if (fuzzyScore !== null) return input.fuzzyBase + fuzzyScore
  }

  return null
}

function scoreSkill(skill: ComposerSkill, query: string) {
  const slug = (skill.slug ?? '').toLowerCase()
  const name = skill.name.toLowerCase()
  const description = skill.description.toLowerCase()
  const scores = [
    scoreQueryMatch({
      value: slug,
      query,
      exactBase: 0,
      prefixBase: 2,
      boundaryBase: 4,
      includesBase: 6,
      fuzzyBase: 100,
    }),
    scoreQueryMatch({
      value: name,
      query,
      exactBase: 1,
      prefixBase: 3,
      boundaryBase: 5,
      includesBase: 7,
      fuzzyBase: 110,
    }),
    scoreQueryMatch({
      value: description,
      query,
      exactBase: 20,
      prefixBase: 22,
      boundaryBase: 24,
      includesBase: 26,
    }),
  ].filter((score): score is number => score !== null)

  return scores.length > 0 ? Math.min(...scores) : null
}

export function searchComposerSkills(
  skills: readonly ComposerSkill[],
  query: string,
) {
  const normalizedQuery = normalizeSkillQuery(query)
  if (!normalizedQuery) return [...skills]

  const ranked: RankedSkill[] = []
  for (const skill of skills) {
    const score = scoreSkill(skill, normalizedQuery)
    if (score === null) continue

    ranked.push({
      skill,
      score,
      tieBreaker: `${(skill.slug ?? skill.name).toLowerCase()}\u0000${skill.id}`,
    })
  }

  return ranked
    .sort(
      (left, right) =>
        left.score - right.score ||
        left.tieBreaker.localeCompare(right.tieBreaker),
    )
    .map((entry) => entry.skill)
}
