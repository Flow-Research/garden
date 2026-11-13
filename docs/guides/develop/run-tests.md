---
title: Run the tests
description: Run all Garden tests, one package's tests, a single test file, or the Postgres integration tests.
status: current
owner: "@Umoren"
last_reviewed: 2026-11-10
---

Garden uses Vitest in every package. The root `pnpm test` script runs `turbo run test`, which runs `vitest run` in each package that has a `test` script.

## Run every test

From the repository root, run:

```bash
pnpm test
```

CI runs the same command in the `Verify` job of `.github/workflows/ci.yml`.

## Run one package

To run the tests for one package, filter by its package name:

```bash
pnpm --filter @garden/web test
pnpm --filter @garden/agent-runtime test
pnpm --filter @garden/db test
```

## Run a single test file

Pass the file path, relative to the package, after the filter:

```bash
pnpm --filter @garden/web test src/lib/server/invitations.integration.test.ts
```

To run one test by name, add `-t`:

```bash
pnpm --filter @garden/web test src/features/automations/queries.test.ts -t "polls while a run"
```

To rerun on save, call Vitest in watch mode:

```bash
pnpm --filter @garden/web exec vitest src/features/automations/queries.test.ts
```

## Run the Postgres integration tests

Integration tests start a real Postgres container. They call `startTestDb` or `withTestDb` from `@garden/db/testing`, which lives in `packages/db/src/testing/container.ts`. Each call starts `postgres:16-alpine` through testcontainers and applies every migration in `packages/db/drizzle`.

1. Start Docker. Testcontainers needs a running Docker daemon. If Docker listens on a non-default socket, set `DOCKER_HOST`. Turbo passes it through.
2. Run the test file or the package:

   ```bash
   pnpm --filter @garden/web test src/routes/api/-automations.integration.test.ts
   ```

There is no separate integration script. Integration test files end in `.integration.test.ts` by convention and run with `pnpm test` like any other test. Without Docker, those files fail.

The agent-runtime approval, Executor, GitHub assignee, and skill assignment suites also use this helper. Each suite owns a migrated Postgres container and cleans it up after the tests. They run in CI through `pnpm test` without `GARDEN_TEST_DATABASE_URL` or a pre-existing local database. Database setup failures fail the suite instead of skipping permission checks.

To run these four suites:

```bash
pnpm --filter @garden/agent-runtime test src/runtime-mcp-controller.approval.test.ts src/runtime-mcp-controller.executor.test.ts src/runtime-mcp-controller.github-assignees.test.ts src/skills-assignments.test.ts
```

## Run the other checks CI runs

CI also runs these root scripts. Run them before you open a pull request:

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm verify:connectors
pnpm verify:docs
pnpm verify:deploy-config
```
