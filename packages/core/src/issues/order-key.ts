import { generateKeyBetween } from 'fractional-indexing'

/**
 * Issue order keys: fractional-indexing strings ("a0", "a0V", "a1", ...).
 * There is always a key between any two, so an issue can be placed anywhere
 * with a single write. Keys compare by UTF-16 code unit, which is what the
 * database's COLLATE "C" column does too; never compare them with
 * localeCompare.
 */

/** The first key, given to issues with no neighbours. */
export const FIRST_ORDER_KEY = 'a0'

/** Code-unit comparison of two order keys, for sorting. */
export function compareOrderKeys(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

/** Whether `key` is a well-formed order key. */
export function isOrderKey(key: string): boolean {
  try {
    generateKeyBetween(key, null)
    return true
  } catch {
    return false
  }
}

/**
 * A key strictly between `before` and `after` (either may be null for "no
 * neighbour on that side"). If the neighbours are not in order, which a race
 * between two clients can cause, it falls back to a key after `before`.
 */
export function orderKeyBetween(
  before: string | null,
  after: string | null,
): string {
  try {
    return generateKeyBetween(before, after)
  } catch {
    return generateKeyBetween(
      before && isOrderKey(before) ? before : null,
      null,
    )
  }
}
