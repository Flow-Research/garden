const MS_PER_DAY = 86_400_000

const positiveOr = (value: number, fallback: number): number =>
  Number.isFinite(value) && value > 0 ? value : fallback

export const freshnessWeight = (input: {
  readonly observedAtMs: number
  readonly nowMs: number
  readonly halfLifeDays: number
}): number => {
  if (!Number.isFinite(input.observedAtMs) || !Number.isFinite(input.nowMs)) {
    return 1
  }
  const halfLifeDays = positiveOr(input.halfLifeDays, 1)
  const ageMs = Math.max(0, input.nowMs - input.observedAtMs)
  return Math.pow(0.5, ageMs / MS_PER_DAY / halfLifeDays)
}

export type FreshnessPolicy = {
  readonly nowMs: number
  readonly halfLifeDays: number
  readonly floor: number
}

export type RankableHit<T> = {
  readonly item: T
  readonly score: number
  readonly observedAtMs: number
}

export type RankedHit<T> = RankableHit<T> & {
  readonly freshness: number
  readonly rankScore: number
}

export const rerankByFreshness = <T>(
  hits: readonly RankableHit<T>[],
  policy: FreshnessPolicy,
): readonly RankedHit<T>[] => {
  const floor = Number.isFinite(policy.floor) ? policy.floor : 0
  return hits
    .map((hit): RankedHit<T> => {
      const freshness = Math.max(
        floor,
        freshnessWeight({
          observedAtMs: hit.observedAtMs,
          nowMs: policy.nowMs,
          halfLifeDays: policy.halfLifeDays,
        }),
      )
      return { ...hit, freshness, rankScore: hit.score * freshness }
    })
    .sort((left, right) => right.rankScore - left.rankScore)
}
