/**
 * Shared display formatters for dates, relative times and counts.
 *
 * One module so every surface renders "5m ago", "Oct 21" and "12.3k" the same
 * way instead of each feature carrying its own copy.
 */

type DateInput = string | number | Date

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const toDate = (value: DateInput) =>
  value instanceof Date ? value : new Date(value)

export interface TimeAgoOptions {
  /** Drop the "ago"/"in" wording: "5m" instead of "5m ago". */
  compact?: boolean
  /**
   * Past this many days, show the short calendar date ("Oct 21") instead of a
   * relative time.
   */
  absoluteAfterDays?: number
  /** Reference time; defaults to now. */
  now?: DateInput
}

/**
 * Relative time: "just now", "5m ago", "3h ago", "2d ago", "4mo ago", "1y ago".
 * Future times read "in 5m". With `compact`, the suffix is dropped ("5m") and
 * the first minute reads "now".
 */
export function timeAgo(
  value: DateInput,
  options: TimeAgoOptions = {},
): string {
  const date = toDate(value)
  const now =
    options.now === undefined ? Date.now() : toDate(options.now).getTime()
  const diff = now - date.getTime()
  const abs = Math.abs(diff)

  if (abs < MINUTE) return options.compact ? 'now' : 'just now'

  const days = Math.floor(abs / DAY)
  if (
    options.absoluteAfterDays !== undefined &&
    days >= options.absoluteAfterDays
  ) {
    return formatShortDate(date)
  }

  let amount: string
  if (abs < HOUR) amount = `${Math.floor(abs / MINUTE)}m`
  else if (abs < DAY) amount = `${Math.floor(abs / HOUR)}h`
  else if (days < 30) amount = `${days}d`
  else if (days < 365) amount = `${Math.floor(days / 30)}mo`
  else amount = `${Math.floor(days / 365)}y`

  if (options.compact) return amount
  return diff >= 0 ? `${amount} ago` : `in ${amount}`
}

/** Short calendar date: "Oct 21". */
export function formatShortDate(value: DateInput): string {
  return toDate(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

/** Short date with time: "Oct 21, 2:05 PM". */
export function formatDateTime(value: DateInput): string {
  return toDate(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * Compact count for tokens and other large numbers: 950, 1.2k, 12.3k, 4.5M.
 */
export function formatCompactNumber(value: number): string {
  const abs = Math.abs(value)
  if (abs < 1_000) return String(value)
  if (abs < 1_000_000) return `${(value / 1_000).toFixed(1)}k`
  return `${(value / 1_000_000).toFixed(1)}M`
}
