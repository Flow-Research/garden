## DB Workflow

This package is code-first.

- `src/schema/*.ts` is the source of truth
- `drizzle/` stores generated migration artifacts
- the live database should be synced from code, not pulled back into code

Use:

```bash
pnpm --filter @garden/db db:check
pnpm --filter @garden/db db:generate
pnpm --filter @garden/db db:sync
```

Notes:

- `db:check` verifies the checked-in Drizzle schema and migration metadata agree
- `db:generate` creates a migration from schema changes
- `db:sync` applies committed migrations to the configured database with `drizzle-kit migrate`
- `drizzle-kit push` is intentionally not exposed here because it introspects the live database first and makes the database, not the repo, drive the diff
- `drizzle-kit introspect` is not part of the normal sync path; it is DB-first and only for one-off forensic work
