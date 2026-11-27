---
title: Deploy targets
description: The Garden deploy targets, the scripts that deploy each one, and the Cloudflare Workers Builds triggers that run them.
status: current
owner: "@Umoren"
last_reviewed: 2026-11-03
---

Garden deploys with Alchemy. `alchemy.run.ts` declares the resources. `deploy-targets.mjs` names them per target. `scripts/deploy-ci.mjs` picks the target in Cloudflare Workers Builds. To deploy, see [Deploy Garden](../guides/operate/deploy.md).

## Targets

| Target    | Branch      | Alchemy stack       | Alchemy stage | Worker           | Tail Worker            | `ENVIRONMENT` | Runs migrations |
| --------- | ----------- | ------------------- | ------------- | ---------------- | ---------------------- | ------------- | --------------- |
| `staging` | `main`      | `garden-production` | `production`  | `garden-staging` | `garden-staging-tail`  | `production`  | Yes             |
| `dev`     | `dev`       | `garden-dev`        | `dev`         | `garden-dev`     | `garden-dev-tail`      | `development` | No              |
| `preview` | Manual only | `garden-preview`    | `preview`     | `garden-preview` | `garden-preview-tail`  | `development` | No              |

The `staging` target keeps the `garden-production` stack and `production` stage so that Alchemy keeps ownership of the existing resources.

## Resources per target

| Resource                 | `staging`                                 | `dev`                                 | `preview`                                 |
| ------------------------ | ----------------------------------------- | ------------------------------------- | ----------------------------------------- |
| `FILES` bucket           | `garden-files-staging`                    | `garden-files-dev`                    | `garden-files-preview`                    |
| `BRAIN_FILES` bucket     | `org-brain`                               | `org-brain-dev`                       | `org-brain-preview`                       |
| Hyperdrive               | `garden-database-staging`                 | `garden-database-dev`                 | `garden-database-preview`                 |
| `EXECUTOR_DB` (D1)       | `harnessy-connectors`                     | `harnessy-connectors-dev`             | `harnessy-connectors-preview`             |
| `EXECUTOR_BLOBS` bucket  | `harnessy-connectors-blobs`               | `harnessy-connectors-blobs-dev`       | `harnessy-connectors-blobs-preview`       |
| `RUN_WORKFLOW`           | `garden-run-workflow-staging`             | `garden-run-workflow-dev`             | `garden-run-workflow-preview`             |
| `DECIDE_ANALYSIS_WORKFLOW` | `garden-decide-analysis-workflow-staging` | `garden-decide-analysis-workflow-dev` | `garden-decide-analysis-workflow-preview` |
| `GITHUB_REPO_IMPORT_WORKFLOW` | `garden-github-repo-import-workflow-staging` | `garden-github-repo-import-workflow-dev` | `garden-github-repo-import-workflow-preview` |
| Sandbox container        | `garden-web-sandbox-staging`              | `garden-web-sandbox-dev`              | `garden-web-sandbox-preview`              |
| AI Gateway               | `garden-staging`                          | `garden-dev`                          | `garden-preview`                          |
| Empty buckets on destroy | No                                        | No                                    | Yes                                       |

Every target reads its Postgres origin from `DATABASE_URL`. The `preview` target shares the live Postgres origin. Its Cloudflare resources and Executor storage stay separate.

## Scripts

These scripts are in the root `package.json`.

| Script                   | Runs                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| `deploy`                 | `pnpm typecheck`, then `deploy:migrate`, then `deploy:alchemy`.                               |
| `deploy:migrate`         | `pnpm --filter @garden/db db:migrate`                                                         |
| `deploy:alchemy`         | `alchemy deploy --stage production --yes` with `GARDEN_DEPLOY_TARGET=staging`.               |
| `deploy:dev`             | `pnpm typecheck`, then `deploy:dev:alchemy`.                                                   |
| `deploy:dev:alchemy`     | `alchemy deploy --stage dev --yes` with `GARDEN_DEPLOY_TARGET=dev`.                           |
| `deploy:preview`         | `pnpm typecheck`, then `deploy:preview:alchemy`.                                               |
| `deploy:preview:alchemy` | `alchemy deploy --stage preview --yes` with `GARDEN_DEPLOY_TARGET=preview`.                   |
| `destroy:preview`        | `alchemy destroy --stage preview --yes` with `GARDEN_DEPLOY_TARGET=preview`.                  |
| `deploy:ci`              | `node scripts/deploy-ci.mjs`                                                                  |
| `verify:deploy-config`   | `node scripts/verify-deploy-config.mjs`. Checks the deploy configuration. Runs in `.github/workflows/ci.yml`. |

Every Alchemy script also sets `ALCHEMY_TELEMETRY_DISABLED=1`.

## `deploy:ci` branch dispatch

`scripts/deploy-ci.mjs` reads `WORKERS_CI_BRANCH`:

| `WORKERS_CI_BRANCH` | Result                                 |
| ------------------- | -------------------------------------- |
| `main`              | Runs `pnpm run deploy` (staging).       |
| `dev`               | Runs `pnpm run deploy:dev`.             |
| Any other branch    | Prints `Skipping automatic deployment` and exits 0. |
| Unset               | Fails.                                 |

## Workers Builds triggers

Cloudflare Workers Builds has a production trigger and a non-production trigger for `Flow-Research/garden`. Both use root directory `/apps/web`. These settings live in the Cloudflare dashboard, not in the repository.

| Trigger        | Branches            | Build command                      |
| -------------- | ------------------- | ---------------------------------- |
| Production     | `main`              | `cd ../.. && pnpm run deploy`      |
| Non-production | Every other branch  | `cd ../.. && pnpm run deploy:ci`   |

Build secrets are set separately on each trigger. Turning on non-production builds copies plain variables only. Cloudflare stores the GitHub repository id. After a repository transfer or replacement, reconnect the trigger. See the Cloudflare [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).

## Migrations in CI

The `Verify migrations` job in `.github/workflows/ci.yml` runs `pnpm --filter @garden/db db:check` and then applies the checked-in migrations with the same runner that the staging deploy uses.
