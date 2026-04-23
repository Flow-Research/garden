## DB Workflow

This package is code-first.

- `src/schema/*.ts` is the source of truth
- `drizzle/` stores generated migration artifacts
- the live database should be synced from code, not pulled back into code

### Schema commands

```bash
pnpm --filter @garden/db db:check     # verify schema + migration metadata agree
pnpm --filter @garden/db db:generate  # create a migration from schema changes
pnpm --filter @garden/db db:sync      # apply committed migrations
```

Notes:

- `db:check` verifies the checked-in Drizzle schema and migration metadata agree
- `db:generate` creates a migration from schema changes
- `db:sync` applies committed migrations to the configured database with `drizzle-kit migrate`
- `drizzle-kit push` is intentionally not exposed here because it introspects the live database first and makes the database, not the repo, drive the diff
- `drizzle-kit introspect` is not part of the normal sync path; it is DB-first and only for one-off forensic work

---

## Integration tests with testcontainers

Integration tests spin up a fresh Postgres per test suite using [testcontainers](https://github.com/testcontainers/testcontainers-node). No reliance on any long-running local stack — every test gets ephemeral, isolated state.

### Run

```bash
pnpm --filter @garden/db test
```

First run pulls the `postgres:16-alpine` image (~90 MB). Subsequent runs reuse the cache and a suite spins up in ~3 s.

### Driver choice: `node-postgres` for tests

Runtime (`apps/web/src/lib/server/db.ts`) uses `drizzle-orm/neon-serverless` against Neon cloud. Tests use `drizzle-orm/node-postgres` against a local Postgres container. Both drivers consume the same Drizzle schema + query builder, so every schema, query, and piece of business logic under test exercises the same surface — only the network transport differs.

This is an intentional choice: the integration tests here exist to catch bugs in *our* schema, queries, and data logic, not to revalidate the Neon driver on every run. Driver-level regressions are better caught by a smoke test hitting a real staging Neon endpoint in CI (future work).

### Pattern

```ts
import { describe, it, beforeAll, afterAll, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { user } from '../schema/users.js'
import { startTestDb, type TestDb } from '../testing/container.js'

describe('users (integration)', () => {
  let testDb: TestDb

  beforeAll(async () => {
    testDb = await startTestDb()
  })

  afterAll(async () => {
    await testDb?.cleanup()
  })

  it('inserts a user and reads it back', async () => {
    const inserted = await testDb.db
      .insert(user)
      .values({ email: 'jane@example.com', name: 'Jane Doe' })
      .returning()

    expect(inserted[0]?.email).toBe('jane@example.com')
  })
})
```

Or use the `withTestDb` wrapper for one-shot tests:

```ts
import { withTestDb } from '../testing/container.js'

it('round-trip', async () => {
  await withTestDb(async ({ db }) => {
    // db is a fresh drizzle client with all migrations applied
  })
})
```

### Helper API (`@garden/db/testing`)

```ts
type TestDb = {
  db: NodePgDatabase<typeof schema>
  pool: Pool
  databaseUrl: string
  cleanup: () => Promise<void>
}

startTestDb(): Promise<TestDb>                   // manual lifecycle
withTestDb(fn: (db) => Promise<T>): Promise<T>   // auto-cleanup
```

Both apply all checked-in migrations against the ephemeral DB before returning.

### Cost model

- ~3 s container spin-up per test suite (warm Docker image cache)
- No external services, runs offline
- Each suite is isolated — no test pollution
- Tests run in parallel packages (turbo) without interference — each suite owns its own container
