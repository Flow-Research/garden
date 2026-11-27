import { describe, expect, it } from 'vitest'
import {
  freshnessWeight,
  rerankByFreshness,
} from '../src/services/freshness.ts'

const now = Date.UTC(2026, 0, 1)
const daysAgo = (days: number) => now - days * 86_400_000

describe('freshnessWeight', () => {
  it('halves at one half-life and approaches zero past it', () => {
    expect(
      freshnessWeight({ observedAtMs: now, nowMs: now, halfLifeDays: 90 }),
    ).toBe(1)
    expect(
      freshnessWeight({
        observedAtMs: daysAgo(90),
        nowMs: now,
        halfLifeDays: 90,
      }),
    ).toBeCloseTo(0.5, 5)
  })

  it('never exceeds one for future timestamps', () => {
    expect(
      freshnessWeight({
        observedAtMs: now + 1000,
        nowMs: now,
        halfLifeDays: 90,
      }),
    ).toBe(1)
  })

  it('treats a non-finite timestamp as fresh instead of poisoning the sort', () => {
    expect(
      freshnessWeight({
        observedAtMs: Number.NaN,
        nowMs: now,
        halfLifeDays: 90,
      }),
    ).toBe(1)
    expect(
      freshnessWeight({
        observedAtMs: now,
        nowMs: Number.NaN,
        halfLifeDays: 90,
      }),
    ).toBe(1)
  })
})

describe('rerankByFreshness', () => {
  it('lets a fresher item overtake an older one at equal score', () => {
    const ranked = rerankByFreshness(
      [
        { item: 'old', score: 1, observedAtMs: daysAgo(180) },
        { item: 'new', score: 1, observedAtMs: daysAgo(1) },
      ],
      { nowMs: now, halfLifeDays: 90, floor: 0 },
    )
    expect(ranked.map((entry) => entry.item)).toEqual(['new', 'old'])
  })

  it('lets a much higher score beat a fresher item', () => {
    const ranked = rerankByFreshness(
      [
        { item: 'strong-old', score: 100, observedAtMs: daysAgo(365) },
        { item: 'weak-new', score: 1, observedAtMs: now },
      ],
      { nowMs: now, halfLifeDays: 90, floor: 0 },
    )
    expect(ranked[0]?.item).toBe('strong-old')
  })

  it('clamps freshness at the floor so old items never vanish', () => {
    const [ranked] = rerankByFreshness(
      [{ item: 'ancient', score: 1, observedAtMs: daysAgo(10_000) }],
      { nowMs: now, halfLifeDays: 90, floor: 0.2 },
    )
    expect(ranked?.freshness).toBe(0.2)
    expect(ranked?.rankScore).toBeCloseTo(0.2, 5)
  })
})
