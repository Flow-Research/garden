import { sql } from 'drizzle-orm'

/**
 * Renders a list of string constants as a SQL value list for CHECK
 * constraints, e.g. `status in (${sqlValueList(issueStatusValues)})`. The
 * values are compile-time constants, so `sql.raw` with quote escaping is safe
 * here; never pass user input.
 */
export function sqlValueList(values: readonly string[]) {
  return sql.raw(
    values.map((value) => `'${value.replace(/'/g, "''")}'`).join(', '),
  )
}
