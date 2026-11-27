# PR #285 corrective verification

Date: 2026-11-27. Scope: this disposable checkout only.

The issue list in `apps/web/src/lib/server/queries/issues/list-workspace-issues.ts` orders by `updated_at DESC`, `created_at DESC`, and `number DESC`. All three columns are `NOT NULL` in `packages/db/src/schema/issues.ts`. The treatment index now uses that same order. No checked-in migration or Drizzle schema defines `issue_workspace_updated_order_idx`, so the index remains an experiment in the treatment database.

Checks run:

- PASS: `node --experimental-strip-types --check packages/db/src/load-test.ts`.
- PASS: JSON parse of `docs/concepts/features/meta.json` with Node.
- PASS: `git diff --name-only --diff-filter=U` returned no paths after staging the resolved conflict.
- PASS: `git diff --check` returned no whitespace errors in the unstaged correction.
- PASS: `pnpm --filter @garden/db typecheck` with the locked dependencies installed.
- PASS: PostgreSQL 16.15, one disposable server, 10x scale, eight scenarios, seven paired samples, four concurrent calls per sample. The treatment issue-list plan used the candidate index. The observed difference in issue-list latency did not meet the significance threshold (p = 0.5156).
- PASS: Sent SIGTERM while a disposable database existed. The command exited with status 1 and the isolated server had zero remaining fixture databases.

The documented `pnpm --filter @garden/db db:load-test` command produced all artifacts. Its output path contained an equals sign. Each of the eight scenarios had zero sample and profile errors. The complete run left zero fixture databases.

The JSON, Markdown, and SVG reports come from the same 10x run. The host was busy at the start (1-minute load average 12.38, 12 logical CPUs). The corrected harness has no 100x or 1000x measurements here.
