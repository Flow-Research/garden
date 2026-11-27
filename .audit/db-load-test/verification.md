# PR #285 corrective verification

Date: 2026-11-27. Scope: this disposable checkout only.

The issue list in `apps/web/src/lib/server/queries/issues/list-workspace-issues.ts` orders by `updated_at DESC`, `created_at DESC`, and `number DESC`. All three columns are `NOT NULL` in `packages/db/src/schema/issues.ts`. The treatment index now uses that same order. No checked-in migration or Drizzle schema defines `issue_workspace_updated_order_idx`, so the index remains an experiment in the treatment database.

Checks run:

- PASS: `node --experimental-strip-types --check packages/db/src/load-test.ts`.
- PASS: JSON parse of `docs/concepts/features/meta.json` with Node.
- PASS: `git diff --name-only --diff-filter=U` returned no paths after staging the resolved conflict.
- PASS: `git diff --check` returned no whitespace errors in the unstaged correction.
- FAIL: `pnpm --filter @garden/db typecheck` could not resolve dependencies because this checkout has no `node_modules`. The output includes `TS2307` for `drizzle-orm`, `vitest`, and Node types. This is not a code typecheck result.
- INCONCLUSIVE: No load test or PostgreSQL plan was run. No local PostgreSQL server or installed dependencies were used.

The earlier reports remain as historical evidence. Run the corrected harness against a disposable local database to obtain a new result.
