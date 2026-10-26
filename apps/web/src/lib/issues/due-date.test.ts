import { describe, expect, it } from 'vitest'
import { dueDateForDay, dueDateInDays } from './due-date'

describe('due dates', () => {
  it('saves the picked day at noon UTC, whatever the local time', () => {
    expect(dueDateForDay(new Date(2026, 9, 23))).toBe(
      '2026-10-23T12:00:00.000Z',
    )
    expect(dueDateForDay(new Date(2026, 9, 23, 23, 45))).toBe(
      '2026-10-23T12:00:00.000Z',
    )
  })

  it('reads back as the picked day in local time', () => {
    const saved = new Date(dueDateForDay(new Date(2026, 9, 23)))
    expect([saved.getFullYear(), saved.getMonth(), saved.getDate()]).toEqual([
      2026, 9, 23,
    ])
  })

  it('counts days from today by calendar day', () => {
    const lateEvening = new Date(2026, 9, 23, 23, 30)
    expect(dueDateInDays(0, lateEvening)).toBe('2026-10-23T12:00:00.000Z')
    expect(dueDateInDays(1, lateEvening)).toBe('2026-10-24T12:00:00.000Z')
    expect(dueDateInDays(7, lateEvening)).toBe('2026-10-30T12:00:00.000Z')
  })
})
