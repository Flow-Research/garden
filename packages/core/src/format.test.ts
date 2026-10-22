import { describe, expect, it } from 'vitest'
import { formatCompactNumber, formatShortDate, timeAgo } from './format'

const NOW = new Date('2026-10-21T12:00:00.000Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms)
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

describe('timeAgo', () => {
  it('renders past times with an "ago" suffix', () => {
    expect(timeAgo(ago(20_000), { now: NOW })).toBe('just now')
    expect(timeAgo(ago(5 * MIN), { now: NOW })).toBe('5m ago')
    expect(timeAgo(ago(3 * HOUR + 59 * MIN), { now: NOW })).toBe('3h ago')
    expect(timeAgo(ago(2 * DAY), { now: NOW })).toBe('2d ago')
    expect(timeAgo(ago(65 * DAY), { now: NOW })).toBe('2mo ago')
    expect(timeAgo(ago(800 * DAY), { now: NOW })).toBe('2y ago')
  })

  it('accepts ISO strings', () => {
    expect(timeAgo(ago(5 * MIN).toISOString(), { now: NOW })).toBe('5m ago')
  })

  it('renders future times with "in"', () => {
    expect(timeAgo(ago(-3 * DAY), { now: NOW })).toBe('in 3d')
  })

  it('drops the wording in compact mode', () => {
    expect(timeAgo(ago(10_000), { now: NOW, compact: true })).toBe('now')
    expect(timeAgo(ago(5 * MIN), { now: NOW, compact: true })).toBe('5m')
    expect(timeAgo(ago(2 * DAY), { now: NOW, compact: true })).toBe('2d')
  })

  it('switches to the calendar date past absoluteAfterDays', () => {
    const old = ago(10 * DAY)
    expect(timeAgo(old, { now: NOW, absoluteAfterDays: 7 })).toBe(
      formatShortDate(old),
    )
    expect(timeAgo(ago(6 * DAY), { now: NOW, absoluteAfterDays: 7 })).toBe(
      '6d ago',
    )
  })
})

describe('formatShortDate', () => {
  it('renders month and day', () => {
    expect(formatShortDate(new Date(2026, 9, 21))).toBe('Oct 21')
  })
})

describe('formatCompactNumber', () => {
  it('renders plain, thousands and millions', () => {
    expect(formatCompactNumber(950)).toBe('950')
    expect(formatCompactNumber(1_234)).toBe('1.2k')
    expect(formatCompactNumber(12_345)).toBe('12.3k')
    expect(formatCompactNumber(4_560_000)).toBe('4.6M')
  })
})
