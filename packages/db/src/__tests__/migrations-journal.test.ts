import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const drizzleDir = fileURLToPath(new URL('../../drizzle/', import.meta.url))

type JournalEntry = { idx: number; when: number; tag: string }

const journal = JSON.parse(
  readFileSync(`${drizzleDir}meta/_journal.json`, 'utf8'),
) as { entries: JournalEntry[] }

/**
 * The drizzle migrator applies a migration only when its `when` is newer than
 * the last applied one, so an out-of-order timestamp silently skips it on
 * databases that were between the two. These checks keep hand edits and merge
 * conflicts from corrupting the journal again.
 */
describe('migration journal', () => {
  it('numbers entries consecutively from 0', () => {
    expect(journal.entries.map((entry) => entry.idx)).toEqual(
      journal.entries.map((_, index) => index),
    )
  })

  it('has strictly increasing timestamps', () => {
    const outOfOrder = journal.entries.filter((entry, index) => {
      const previous = journal.entries.at(index - 1)
      return index > 0 && previous !== undefined && entry.when <= previous.when
    })
    expect(outOfOrder.map((entry) => entry.tag)).toEqual([])
  })

  it('has a unique tag and an SQL file for every entry', () => {
    const tags = journal.entries.map((entry) => entry.tag)
    expect(new Set(tags).size).toBe(tags.length)
    const missing = tags.filter((tag) => !existsSync(`${drizzleDir}${tag}.sql`))
    expect(missing).toEqual([])
  })
})
