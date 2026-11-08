---
title: Write a database migration
description: Change the Garden Postgres schema by editing the Drizzle schema, generating a migration, and applying it.
status: current
owner: "@Umoren"
last_reviewed: 2026-11-03
---

The Drizzle schema in `packages/db/src/schema/` is the source of truth. Migrations in `packages/db/drizzle/` are generated from it. Do not write schema SQL by hand.

The `@garden/db` scripts load the root `.env` through `scripts/run-with-root-env.mjs`. `packages/db/drizzle.config.ts` reads `DATABASE_URL` from it.

## Change the schema

1. Edit the table file in `packages/db/src/schema/`, such as `packages/db/src/schema/issues.ts`.
2. If you add a new schema file, export it from `packages/db/src/schema/index.ts`.
3. Generate the migration:

   ```bash
   pnpm --filter @garden/db db:generate
   ```

   Drizzle Kit writes a new numbered `.sql` file to `packages/db/drizzle/` and updates `packages/db/drizzle/meta/`.

4. Read the generated SQL. A column rename can appear as a drop and an add. If Drizzle Kit asks whether a column was renamed, answer at the prompt.
5. Apply the migration to your local database:

   ```bash
   pnpm --filter @garden/db db:migrate
   ```

6. Check that the schema and the migration metadata agree:

   ```bash
   pnpm --filter @garden/db db:check
   ```

7. Commit the schema change, the `.sql` file, and the `meta/` changes together.

## Write a data migration

Raw SQL is allowed only for data changes that Drizzle Kit cannot generate, such as a backfill or a data repair. To create an empty migration file in the same sequence, run:

```bash
pnpm --filter @garden/db db:generate --custom --name backfill_issue_keys
```

Write the SQL in the new file, then apply and check it as in steps 5 and 6.

## What CI checks

The `Verify migrations` job in `.github/workflows/ci.yml` starts `postgres:16-alpine`, runs `pnpm --filter @garden/db db:check`, and applies every migration with `pnpm run deploy:migrate`. A migration that Drizzle Kit cannot parse fails there before it reaches the staging deploy.

Integration tests also apply every migration to a fresh container. See [Run the tests](./run-tests.md).

## How migrations reach staging

The `deploy` script runs `deploy:migrate` before the Alchemy deploy. Only the `staging` target runs migrations. See [Deploy targets](../../reference/deploy-targets.md).

Do not use `drizzle-kit push` or `drizzle-kit introspect`. `@garden/db` does not expose them because they let the live database drive the schema.
