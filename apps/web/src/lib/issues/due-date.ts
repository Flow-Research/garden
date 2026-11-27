/**
 * Stores a due date picked as a local calendar day.
 *
 * Due dates are saved as a timestamp. Saving local midnight (`toISOString()`
 * of the picked day) put the instant on the previous day in UTC for anyone
 * east of Greenwich, so the issue showed as due a day early to viewers in
 * other time zones. Noon UTC on the picked day reads as that same day in
 * every zone from UTC−11 to UTC+11, so it displays correctly everywhere
 * without changing how dates are read.
 */
export function dueDateForDay(day: Date): string {
  return new Date(
    Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), 12),
  ).toISOString()
}

/** The due date `days` calendar days from today. */
export function dueDateInDays(days: number, now = new Date()): string {
  const day = new Date(now)
  day.setDate(day.getDate() + days)
  return dueDateForDay(day)
}
