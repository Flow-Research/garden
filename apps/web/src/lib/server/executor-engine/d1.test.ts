// @vitest-environment node
import { DatabaseSync } from 'node:sqlite'
import { collectTables } from '@executor-js/sdk/core'
import { Effect, Result } from 'effect'
import { expect, it, onTestFinished } from 'vitest'
import { createD1ExecutorDb } from './d1'

// Exercise the production adapter's SQL against SQLite. This facade supplies
// the D1 batch contract without starting a Worker or relying on a hosted binding.
const sqliteD1 = (sqlite: DatabaseSync): D1Database => {
  const unsupported = () => {
    throw new Error('Unexpected operation in D1 SQL proof')
  }
  const prepare = (
    query: string,
    parameters: unknown[] = [],
  ): D1PreparedStatement => ({
    bind: (...bound) => prepare(query, bound),
    first: unsupported,
    all: unsupported,
    raw: unsupported,
    async run<T>(): Promise<D1Result<T>> {
      const parametersForSqlite = parameters.map((value) => {
        if (
          value === null ||
          typeof value === 'string' ||
          typeof value === 'number'
        )
          return value
        throw new Error('Unexpected SQLite parameter in D1 SQL proof')
      })
      const result = sqlite.prepare(query).run(...parametersForSqlite)
      const changes = Number(result.changes)
      return {
        success: true,
        results: [],
        meta: {
          duration: 0,
          size_after: 0,
          rows_read: 0,
          rows_written: changes,
          last_row_id: Number(result.lastInsertRowid),
          changed_db: changes > 0,
          changes,
        },
      }
    },
  })
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

it('removes only the revoked generation and rolls back the catalogue on batch failure', async () => {
  const sqlite = new DatabaseSync(':memory:')
  onTestFinished(() => sqlite.close())
  const tables = collectTables()
  const { connection, tool, definition } = tables
  if (!connection || !tool || !definition)
    throw new Error('Missing Executor tables')
  const handle = await Effect.runPromise(
    createD1ExecutorDb(sqliteD1(sqlite), tables),
  )
  const connectionTable = connection.names.sql
  const toolTable = tool.names.sql
  const definitionTable = definition.names.sql
  for (const subject of ['alice', 'bob']) {
    sqlite
      .prepare(
        `insert into "${connectionTable}" (row_id, tenant, owner, subject, integration, name, template, provider, item_ids, refresh_item_id, created_at, updated_at) values (?, 'team', 'user', ?, 'workstream', 'Workstream', 'oauth2', 'encrypted', '{}', ?, 1, 1)`,
      )
      .run(subject, subject, `${subject}-current`)
    sqlite
      .prepare(
        `insert into "${toolTable}" (row_id, tenant, owner, subject, integration, connection, name, plugin_id, description, created_at, updated_at) values (?, 'team', 'user', ?, 'workstream', 'Workstream', 'whoami', 'mcp', '', 1, 1)`,
      )
      .run(subject, subject)
    sqlite
      .prepare(
        `insert into "${definitionTable}" (row_id, tenant, owner, subject, integration, connection, name, plugin_id, schema, created_at) values (?, 'team', 'user', ?, 'workstream', 'Workstream', 'output', 'mcp', '{}', 1)`,
      )
      .run(subject, subject)
  }
  const remove = (refreshItemId: string) =>
    handle.removeOAuthConnectionGeneration({
      tenant: 'team',
      owner: 'user',
      subject: 'alice',
      integration: 'workstream',
      name: 'Workstream',
      refreshItemId,
    })
  const inventory = () =>
    [connectionTable, toolTable, definitionTable].map((table) =>
      sqlite
        .prepare(`select subject from "${table}" order by subject`)
        .all()
        .map((row) => row.subject),
    )
  const both = [
    ['alice', 'bob'],
    ['alice', 'bob'],
    ['alice', 'bob'],
  ]
  expect(await Effect.runPromise(remove('alice-old'))).toBe(false)
  expect(inventory()).toEqual(both)

  sqlite.exec(
    `create trigger reject_definition_removal before delete on "${definitionTable}" when old.subject = 'alice' begin select raise(abort, 'fixture write failure'); end`,
  )
  expect(
    Result.isFailure(
      await Effect.runPromise(remove('alice-current').pipe(Effect.result)),
    ),
  ).toBe(true)
  expect(inventory()).toEqual(both)
  sqlite.exec('drop trigger reject_definition_removal')

  expect(await Effect.runPromise(remove('alice-current'))).toBe(true)
  expect(inventory()).toEqual([['bob'], ['bob'], ['bob']])
})
