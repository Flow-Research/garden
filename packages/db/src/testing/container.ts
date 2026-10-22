import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from 'testcontainers'
import * as schema from '../schema/index.js'

const here = dirname(fileURLToPath(import.meta.url))
export const MIGRATIONS_DIR = resolve(here, '../../drizzle')

const POSTGRES_IMAGE = 'postgres:16-alpine'

export type StartTestDbOptions = {
  /**
   * Apply migrations only up to and including this number (the leading
   * digits of the migration tag), so a test can seed data and then run the
   * remaining migrations itself from MIGRATIONS_DIR.
   */
  migrationsUpTo?: number
}

export type TestDb = {
  db: NodePgDatabase<typeof schema>
  pool: Pool
  databaseUrl: string
  cleanup: () => Promise<void>
}

/**
 * Spin up an isolated Postgres via testcontainers, apply all checked-in
 * migrations, and return a drizzle client pointed at it.
 *
 * Driver choice: node-postgres (not neon-serverless). Runtime uses
 * drizzle-orm/neon-serverless against Neon cloud; tests use node-postgres
 * against a local Postgres container. Both drivers speak the same Drizzle
 * schema + query API, so every schema/query under test exercises the same
 * surface — only the transport differs. This keeps tests offline, ~3s per
 * suite, and independent of any Neon-specific local proxy.
 *
 * Caller must invoke `cleanup()` (or use `withTestDb`) to tear down.
 */
export async function startTestDb(
  options: StartTestDbOptions = {},
): Promise<TestDb> {
  const postgres = await new GenericContainer(POSTGRES_IMAGE)
    .withEnvironment({
      POSTGRES_USER: 'test',
      POSTGRES_PASSWORD: 'test',
      POSTGRES_DB: 'test',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(
      Wait.forLogMessage(/database system is ready to accept connections/, 2),
    )
    .start()

  const host = postgres.getHost()
  const port = postgres.getMappedPort(5432)
  const databaseUrl = `postgres://test:test@${host}:${port}/test`

  const pool = new Pool({ connectionString: databaseUrl })
  const db = drizzle(pool, { schema })

  if (options.migrationsUpTo === undefined) {
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR })
  } else {
    const folder = migrationsFolderUpTo(options.migrationsUpTo)
    try {
      await migrate(db, { migrationsFolder: folder })
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  }

  return {
    db,
    pool,
    databaseUrl,
    cleanup: () => stopAll(pool, postgres),
  }
}

/** A temporary copy of the migrations whose journal stops at `upTo`. */
function migrationsFolderUpTo(upTo: number) {
  const folder = mkdtempSync(join(tmpdir(), 'garden-migrations-'))
  cpSync(MIGRATIONS_DIR, folder, { recursive: true })
  const journalPath = join(folder, 'meta', '_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: Array<{ tag: string }>
  }
  journal.entries = journal.entries.filter(
    (entry) => Number(entry.tag.slice(0, 4)) <= upTo,
  )
  writeFileSync(journalPath, JSON.stringify(journal))
  return folder
}

/**
 * Convenience wrapper: spin up a test db, run `fn`, always tear down.
 */
export async function withTestDb<T>(
  fn: (testDb: TestDb) => Promise<T>,
): Promise<T> {
  const testDb = await startTestDb()
  try {
    return await fn(testDb)
  } finally {
    await testDb.cleanup()
  }
}

async function stopAll(
  pool: Pool,
  postgres: StartedTestContainer,
): Promise<void> {
  await pool.end()
  await postgres.stop()
}
