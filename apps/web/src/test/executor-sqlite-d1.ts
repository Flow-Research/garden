import type { DatabaseSync } from 'node:sqlite'

// Exercise the production adapter's SQL against SQLite. This facade supplies
// the D1 batch contract without starting a Worker or relying on a hosted binding.
export const sqliteD1 = (sqlite: DatabaseSync): D1Database => {
  const unsupported = () => {
    throw new Error('Unexpected operation in D1 SQL proof')
  }
  const meta = (changes = 0, lastRowId = 0) =>
    ({
      duration: 0,
      size_after: 0,
      rows_read: 0,
      rows_written: changes,
      last_row_id: lastRowId,
      changed_db: changes > 0,
      changes,
    }) satisfies D1Meta
  const prepare = (
    query: string,
    parameters: unknown[] = [],
  ): D1PreparedStatement => {
    const parametersForSqlite = parameters.map((value) => {
      if (
        value === null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'bigint'
      )
        return value
      if (typeof value === 'boolean') return Number(value)
      if (value instanceof Uint8Array) return value
      throw new Error('Unexpected SQLite parameter in D1 SQL proof')
    })
    const raw = async (options?: { columnNames?: boolean }) => {
      const statement = sqlite.prepare(query)
      const columns = statement.columns().map((column) => column.name)
      const data = statement
        .all(...parametersForSqlite)
        .map((row) => columns.map((name) => row[name]))
      return options?.columnNames ? [columns, ...data] : data
    }
    return {
      bind: (...bound) => prepare(query, bound),
      first: unsupported,
      raw: raw as D1PreparedStatement['raw'],
      async all<T>(): Promise<D1Result<T>> {
        const results = sqlite.prepare(query).all(...parametersForSqlite)
        return { success: true, results: results as T[], meta: meta() }
      },
      async run<T>(): Promise<D1Result<T>> {
        const result = sqlite.prepare(query).run(...parametersForSqlite)
        return {
          success: true,
          results: [],
          meta: meta(Number(result.changes), Number(result.lastInsertRowid)),
        }
      },
    }
  }
  return {
    prepare,
    batch<T>(statements: D1PreparedStatement[]) {
      sqlite.exec('begin')
      return Promise.all(
        statements.map((statement) => statement.run<T>()),
      ).then(
        (results) => {
          sqlite.exec('commit')
          return results
        },
        (error: unknown) => {
          sqlite.exec('rollback')
          throw error
        },
      )
    },
    exec: unsupported,
    withSession: unsupported,
    dump: unsupported,
  }
}
