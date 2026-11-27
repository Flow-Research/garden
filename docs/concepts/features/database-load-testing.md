---
title: Database load testing uses real Garden relationships
description: How maintainers seed scaled PostgreSQL fixtures and compare query latency with a candidate index.
status: current
owner: '@Umoren'
last_reviewed: 2026-11-27
---

Garden has a repeatable PostgreSQL load suite for relationship-heavy product queries. The suite creates an isolated database, applies the checked-in migrations, seeds one workspace at 10x, 100x, or 1000x, and runs query shapes copied from Garden routes and server helpers.

## Why the suite uses database copies

The suite creates a baseline database and a treatment database from the same seeded source. The baseline has no candidate index. The treatment adds the candidate index. This keeps rows and foreign keys equal between the two sides.

The current treatment is `issue_workspace_updated_order_idx`. It covers the workspace filter and the descending issue-list order used by `GET /api/issues`.

The suite requires `LOAD_TEST_DATABASE_URL` for a dedicated PostgreSQL server on a loopback host. It creates temporary databases there and drops them after the run. Set it to a different URL from `DATABASE_URL`.

## Run the suite

Set `LOAD_TEST_DATABASE_URL` to a dedicated local PostgreSQL server with database creation rights. Then run:

```bash
pnpm --filter @garden/db db:load-test
```

The default run uses 10x, 100x, and 1000x, seven paired samples per query, and four concurrent calls per sample. Use a smaller run while checking the harness:

```bash
pnpm --filter @garden/db db:load-test -- --scale=10 --repetitions=1 --concurrency=1
```

The command writes `report.json`, `report.md`, and `report.svg` to a new `/tmp/garden-db-load-test-<pid>` directory. Use `--output=/tmp/garden-load-test` to choose another directory. The `--concurrency` limit is 8. Use `--keep-databases=true` only when you need to inspect the temporary PostgreSQL copies.

## What the suite measures

The workload covers these real relationship paths:

- issue count and ordered page;
- issue and comment search;
- issue comments, attachments, and run events;
- Inbox source queries;
- agent audit and activity feeds;
- chat threads with agents and primary issues;
- automation run history;
- assigned skills.

Each query runs one warmup call before profiling and timed samples. Each paired sample runs the before and after sides in a deterministic order. The suite consumes rows and compares full row-multiset checksums. It ignores row order inside each result set because some real queries have non-unique timestamp ties. It records failed queries and mismatched results as errors.

The report includes the median, p95, range, paired bootstrap confidence interval, sign-flip p-value, and verdict. A result is `inconclusive` when a query fails or has fewer than five valid pairs. `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` runs after warmup and outside the timed region. The report records scan, sort, index, and buffer evidence.

## Where it lives

The harness is `packages/db/src/load-test.ts`. The package command is `db:load-test` in `packages/db/package.json`. The candidate issue-list index is created only in the treatment database by the harness. This change does not add a production index. The earlier local report did not show the candidate index in the captured plans, so it cannot support a performance claim.

The query sources that define the workload include `apps/web/src/routes/api/issues.ts`, `apps/web/src/routes/api/issues/search.ts`, `apps/web/src/routes/api/issues/$id/timeline.ts`, `apps/web/src/lib/server/inbox-compute.ts`, `apps/web/src/routes/api/agents/$id/activity.ts`, `apps/web/src/routes/api/chat/threads.ts`, and `apps/web/src/lib/server/automations.ts`.

## Data and permissions

The suite writes only to generated temporary databases. It does not write to Garden tables in the configured database. The fixture uses deterministic UUIDs and real foreign keys between users, workspaces, teams, agents, issues, comments, runs, events, work products, automations, skills, documents, permissions, audit rows, and Inbox items.

## How to verify it

Run the database typecheck, lint, schema check, and load suite. Read `report.json` for errors and paired result witnesses. Read `report.md` for timing and plan summaries. Confirm that the candidate index appears in the treatment plan before interpreting the latency comparison. Open the generated `report.svg` to compare medians across scales.

```bash
pnpm --filter @garden/db typecheck
pnpm --filter @garden/db lint
pnpm --filter @garden/db db:check
pnpm --filter @garden/db db:load-test
```

## Gaps and follow-up

The fixture is local and synthetic. It does not model production network latency, Worker scheduling, connection-pool contention across services, or external connector calls. This harness accepts only a loopback database server. A separate approved experiment is needed before setting a production capacity limit.
