// @vitest-environment node
import { DatabaseSync } from 'node:sqlite'
import { collectTables } from '@executor-js/sdk/core'
import { Effect, Result } from 'effect'
import { expect, it, onTestFinished } from 'vitest'
import { sqliteD1 } from '@/test/executor-sqlite-d1'
import { createD1ExecutorDb } from './d1'

it('removes only the revoked generation and rolls back the catalogue on batch failure', async () => {
  const sqlite = new DatabaseSync(':memory:')
  onTestFinished(() => sqlite.close())
  const tables = collectTables()
  const { connection, tool, definition, plugin_storage } = tables
  if (!connection || !tool || !definition || !plugin_storage)
    throw new Error('Missing Executor tables')
  const handle = await Effect.runPromise(
    createD1ExecutorDb(sqliteD1(sqlite), tables),
  )
  const connectionTable = connection.names.sql
  const toolTable = tool.names.sql
  const definitionTable = definition.names.sql
  const secretsTable = plugin_storage.names.sql
  for (const subject of ['alice', 'bob']) {
    sqlite
      .prepare(
        `insert into "${connectionTable}" (row_id, tenant, owner, subject, integration, name, template, provider, item_ids, refresh_item_id, created_at, updated_at) values (?, 'team', 'user', ?, 'workstream', 'Workstream', 'oauth2', 'encrypted', ?, ?, 1, 1)`,
      )
      .run(
        subject,
        subject,
        JSON.stringify({ token: `${subject}-access` }),
        `${subject}-current`,
      )
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
    for (const key of [`${subject}-access`, `${subject}-current`]) {
      sqlite
        .prepare(
          `insert into "${secretsTable}" (row_id, tenant, owner, subject, plugin_id, collection, key, data, created_at, updated_at) values (?, 'team', 'user', ?, 'encryptedSecrets', 'secrets', ?, '"sealed"', 1, 1)`,
        )
        .run(key, subject, key)
    }
  }
  const remove = (refreshItemId: string) =>
    handle.workstreamOAuthStorage.remove(
      {
        tenant: 'team',
        owner: 'user',
        subject: 'alice',
        integration: 'workstream',
        name: 'Workstream',
      },
      { provider: 'encrypted', accessItemId: 'alice-access', refreshItemId },
    )
  const inventory = () =>
    [connectionTable, toolTable, definitionTable, secretsTable].map((table) =>
      sqlite
        .prepare(`select subject from "${table}" order by subject`)
        .all()
        .map((row) => row.subject),
    )
  const both = [
    ['alice', 'bob'],
    ['alice', 'bob'],
    ['alice', 'bob'],
    ['alice', 'alice', 'bob', 'bob'],
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
  expect(inventory()).toEqual([['bob'], ['bob'], ['bob'], ['bob', 'bob']])
})

it('publishes only the winning mint or refresh and rolls back ciphertext and callback state together', async () => {
  const sqlite = new DatabaseSync(':memory:')
  onTestFinished(() => sqlite.close())
  const tables = collectTables()
  const { connection, oauth_session, plugin_storage } = tables
  if (!connection || !oauth_session || !plugin_storage)
    throw new Error('Missing Executor grant tables')
  const { workstreamOAuthStorage: storage } = await Effect.runPromise(
    createD1ExecutorDb(sqliteD1(sqlite), tables),
  )
  const connectionTable = connection.names.sql
  const sessionTable = oauth_session.names.sql
  const secretsTable = plugin_storage.names.sql
  const key = {
    tenant: 'team',
    owner: 'user' as const,
    subject: 'alice',
    integration: 'workstream',
    name: 'workstream',
  }
  const items = (generation: string) => ({
    provider: 'encrypted' as const,
    accessItemId: `${generation}-access`,
    refreshItemId: `${generation}-refresh`,
  })
  const mint = (
    generation: string,
    expected: ReturnType<typeof items> | null,
  ) => {
    sqlite
      .prepare(
        `insert into "${sessionTable}" (row_id, tenant, owner, subject, state, client_slug, integration, name, template, redirect_url, payload, expires_at, created_at) values (?, 'team', 'user', 'alice', ?, 'garden', 'workstream', 'workstream', 'oauth2', 'https://garden.example/callback', '{}', ?, 1)`,
      )
      .run(generation, generation, Date.now() + 60_000)
    return storage.write({
      key,
      next: items(generation),
      accessCiphertext: 'sealed-access',
      refreshCiphertext: 'sealed-refresh',
      expiresAt: 10,
      oauthScope: 'offline_access',
      change: {
        kind: 'mint',
        expected,
        sessionState: generation,
        template: 'oauth2',
        oauthClient: 'garden',
        oauthClientOwner: 'org',
        identityLabel: null,
        derivedIdentityLabel: null,
        missingOAuthScopes: [],
      },
    })
  }
  const rotate = (generation: string, expected: string) =>
    storage.write({
      key,
      next: items(generation),
      accessCiphertext: 'sealed-access',
      refreshCiphertext: 'sealed-refresh',
      expiresAt: 20,
      oauthScope: null,
      change: { kind: 'rotate', expected: items(expected) },
    })
  const current = () =>
    sqlite.prepare(`select refresh_item_id from "${connectionTable}"`).get()
      ?.refresh_item_id
  const inventory = () =>
    sqlite
      .prepare(`select key from "${secretsTable}" order by key`)
      .all()
      .map((row) => row.key)
  const callbacks = () =>
    sqlite
      .prepare(`select state from "${sessionTable}" order by state`)
      .all()
      .map((row) => row.state)

  const first = mint('first', null)
  const competingFirst = mint('losing-first', null)
  expect(await Effect.runPromise(first)).toBe(true)
  expect(await Effect.runPromise(competingFirst)).toBe(false)
  expect(inventory()).toEqual(['first-access', 'first-refresh'])
  expect(callbacks()).toEqual(['losing-first'])

  const failed = mint('failed', items('first'))
  sqlite.exec(
    `create trigger reject_ciphertext before insert on "${secretsTable}" when new.key = 'failed-refresh' begin select raise(abort, 'fixture ciphertext failure'); end`,
  )
  expect(
    Result.isFailure(await Effect.runPromise(failed.pipe(Effect.result))),
  ).toBe(true)
  expect(current()).toBe('first-refresh')
  expect(inventory()).toEqual(['first-access', 'first-refresh'])
  expect(callbacks()).toEqual(['failed', 'losing-first'])
  sqlite.exec('drop trigger reject_ciphertext')

  const reconnect = mint('replacement', items('first'))
  const competingReconnect = mint('losing-reconnect', items('first'))
  expect(await Effect.runPromise(reconnect)).toBe(true)
  expect(await Effect.runPromise(competingReconnect)).toBe(false)
  expect(await Effect.runPromise(rotate('stale', 'first'))).toBe(false)
  expect(await Effect.runPromise(rotate('rotated', 'replacement'))).toBe(true)
  expect(await Effect.runPromise(rotate('losing-rotate', 'replacement'))).toBe(
    false,
  )
  expect(current()).toBe('rotated-refresh')
  expect(inventory()).toEqual(['rotated-access', 'rotated-refresh'])
  expect(await Effect.runPromise(storage.remove(key, items('rotated')))).toBe(
    true,
  )
  expect(await Effect.runPromise(rotate('after-disconnect', 'rotated'))).toBe(
    false,
  )
  expect(current()).toBeUndefined()
  expect(inventory()).toEqual([])
})
