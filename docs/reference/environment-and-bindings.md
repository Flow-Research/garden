---
title: Environment variables and Worker bindings
description: Every binding and environment variable the Garden web Worker uses, with its type, purpose, and where the code reads it.
status: current
owner: "@Umoren"
last_reviewed: 2026-11-03
---

The Garden web Worker is declared twice. `apps/web/wrangler.jsonc` configures local development. `alchemy.run.ts` provisions the deployed Worker for each target in `deploy-targets.mjs`. The runtime type for both is `AppEnv` in `apps/web/src/lib/server/env.ts`. Node tooling validates a subset through `parseServerEnv` and `getServerEnv` in `packages/env/src/index.ts`.

To regenerate the lists on this page, read the `durable_objects`, `workflows`, `r2_buckets`, `d1_databases`, `hyperdrive`, `vars`, and `secrets` keys in `apps/web/wrangler.jsonc`, the `env` object and `deployed.bind` calls in `alchemy.run.ts`, and the `AppEnv` type.

## Durable Objects

| Binding                        | Class                                | Purpose                                                    | Read in                                                                        |
| ------------------------------ | ------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `AgentDO`                      | `AgentDO`                            | One parent runtime per agent. Hosts chat, issue-run, and automation-run sub-agents. | `packages/agent-runtime/src/agent-do.ts`                                       |
| `Sandbox`                      | `Sandbox`                            | Cloudflare Sandbox container (`docker.io/cloudflare/sandbox:0.12.4-python`, `lite`, max 4 instances). | `apps/web/src/server.ts` (`proxyToSandbox`), `packages/agent-runtime/src/sandbox-tools.ts` |
| `AUTOMATION_TRIGGER`           | `AutomationTriggerDO`                | Schedules automation triggers.                             | `apps/web/src/lib/server/automations.ts`                                       |
| `EXECUTOR_MCP_SESSION`         | `ExecutorMcpSession`                 | Executor MCP session per connector session.                | `apps/web/src/lib/server/executor-engine/mcp.ts`                               |
| `EXECUTOR_MCP_EXECUTION_OWNER` | `ExecutorMcpExecutionOwnerDirectory` | Maps Executor executions to their owning session.          | `apps/web/src/lib/server/executor-engine/mcp.ts`                               |
| `WORKSPACE_REALTIME`           | `WorkspaceRealtimeDO`                | Workspace realtime hub.                                    | `apps/web/src/lib/server/realtime.ts`                                          |

Durable Object migrations run from tag `v1` to `v11` in `apps/web/wrangler.jsonc`. Tag `v11` adds `WorkspaceRealtimeDO`.

## Workflows

| Binding                    | Class                    | Local name                               | Purpose                                         | Read in                                                                          |
| -------------------------- | ------------------------ | ---------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------- |
| `RUN_WORKFLOW`             | `RunWorkflow`            | `garden-run-workflow-local`              | Durable execution for issue and automation runs. | `packages/server/src/issues/run-service.ts`, `packages/server/src/automations/run-service.ts` |
| `DECIDE_ANALYSIS_WORKFLOW` | `DecideAnalysisWorkflow` | `garden-decide-analysis-workflow-local`  | Durable Decide analysis runs.                   | `apps/web/src/lib/server/decide-analysis/service.ts`                             |
| `GITHUB_REPO_IMPORT_WORKFLOW` | `GitHubRepoImportWorkflow` | `garden-github-repo-import-workflow-local` | Imports a linked repository's open GitHub issues onto a Team board. | `apps/web/src/lib/server/team-repositories.ts` |

Deployed Workflow names come from `workflowName`, `decideAnalysisWorkflowName`, and `githubRepoImportWorkflowName` in `deploy-targets.mjs`.

## Storage

| Binding          | Type       | Local resource                   | Purpose                                     | Read in                                                     |
| ---------------- | ---------- | -------------------------------- | ------------------------------------------- | ----------------------------------------------------------- |
| `HYPERDRIVE`     | Hyperdrive | placeholder id                   | Connection pool to the Postgres database. Query caching is disabled in `alchemy.run.ts` so reads see the Worker's own writes. | `packages/server/src/issues/run-service.ts`, `packages/server/src/automations/run-service.ts` |
| `EXECUTOR_DB`    | D1         | `garden-executor-local`          | Executor connector state.                   | `apps/web/src/lib/server/executor-runtime.ts`               |
| `EXECUTOR_BLOBS` | R2         | `garden-executor-blobs-local`    | Executor blob storage.                      | `apps/web/src/lib/server/executor-runtime.ts`               |
| `FILES`          | R2         | `garden-files-local`             | Uploads, attachments, and run files.        | `packages/agent-runtime/src/agent-tools/read-attachment.ts`  |
| `BRAIN_FILES`    | R2         | `org-brain-local`                | Org Brain files.                            | `packages/agent-runtime/src/agent-do.ts`                    |

Deployed resource names come from `deploy-targets.mjs`. See [Deploy targets](./deploy-targets.md).

## Platform bindings

| Binding   | Type            | Purpose                                                        | Read in                                                     |
| --------- | --------------- | -------------------------------------------------------------- | ----------------------------------------------------------- |
| `AI`      | Workers AI      | Default model provider. `remote: true` in local development.   | `packages/agent-runtime/src/model.ts`                       |
| `BROWSER` | Browser Rendering | Browser tools for automation runs.                            | `packages/agent-runtime/src/automation-run-sub-agent.ts`    |
| `LOADER`  | Worker Loader   | Loads dynamic Workers for code execution.                      | `packages/agent-runtime/src/run-sub-agent-base.ts`          |

## Cron trigger

| Schedule        | Handler                                    | Purpose                                                       |
| --------------- | ------------------------------------------ | ------------------------------------------------------------- |
| `0 */12 * * *`  | `scheduled` in `apps/web/src/server.ts`    | Calls `reconcile(env)` to repair stale issue-run ledger state. |

The same schedule is set in `apps/web/wrangler.jsonc` and `alchemy.run.ts`.

## Runtime variables and secrets

The Required column means the Worker fails to deploy or validate without the value. Secrets are passed with `Config.redacted` in `alchemy.run.ts` and listed under `secrets.required` in `apps/web/wrangler.jsonc`.

| Name                          | Kind   | Required             | Purpose                                                             | Read in                                                  |
| ----------------------------- | ------ | -------------------- | ------------------------------------------------------------------- | -------------------------------------------------------- |
| `DATABASE_URL`                | Secret | Yes                  | Postgres connection string. Must start with `postgres://` or `postgresql://`. | `packages/db/src/client.ts`, `packages/env/src/index.ts` |
| `DEV_DATABASE_URL`            | Build secret | Dev deploys only | Dev Neon branch connection string. `scripts/deploy-dev.mjs` copies it into `DATABASE_URL` for migrations, Hyperdrive, and the Worker secret. | `deploy-targets.mjs`, `scripts/deploy-dev.mjs` |
| `BETTER_AUTH_SECRET`          | Secret | Yes                  | Better Auth signing secret.                                         | `apps/web/src/auth.ts`                                   |
| `BETTER_AUTH_URL`             | Var    | Yes                  | Public origin. Alchemy sets it to the Worker URL.                   | `apps/web/src/auth.ts`                                   |
| `ENVIRONMENT`                 | Var    | Yes                  | `development`, `test`, `staging`, or `production`.                  | `packages/env/src/index.ts`, `packages/agent-runtime/src/model.ts` |
| `EXECUTOR_SECRET_KEY`         | Secret | Yes                  | Executor encryption key.                                            | `apps/web/src/lib/server/executor-runtime.ts`            |
| `HELIX_URL`                   | Var    | Yes in deployed Workers | Org Brain HelixDB base URL.                                      | `packages/agent-runtime/src/brain-injection.ts`          |
| `HELIX_API_KEY`               | Secret | Yes in deployed Workers | Org Brain HelixDB key.                                           | `apps/web/src/routes/api/brain/`                         |
| `GOOGLE_AUTH_CLIENT_ID`       | Var    | Pair, optional       | Google sign-in client id.                                           | `apps/web/src/lib/auth/instance.ts`                      |
| `GOOGLE_AUTH_CLIENT_SECRET`   | Secret | Pair, optional       | Google sign-in client secret.                                       | `apps/web/src/lib/auth/instance.ts`                      |
| `GOOGLE_CLIENT_ID`            | Var    | Yes in deployed Workers | Gmail and Google Drive connector OAuth client id.                | `packages/connectors/src/oauth.ts`                       |
| `GOOGLE_CLIENT_SECRET`        | Secret | Yes in deployed Workers | Gmail and Google Drive connector OAuth client secret.            | `packages/connectors/src/oauth.ts`                       |
| `GITHUB_CLIENT_ID`            | Var    | No                   | GitHub OAuth client id.                                             | `packages/connectors/src/oauth.ts`                       |
| `GITHUB_CLIENT_SECRET`        | Secret | No                   | GitHub OAuth client secret.                                         | `packages/connectors/src/oauth.ts`                       |
| `GITHUB_APP_ID`               | Var    | No                   | GitHub App id.                                                      | `packages/connectors/src/github-app.ts`                  |
| `GITHUB_APP_SLUG`             | Var    | No                   | GitHub App slug.                                                    | `packages/connectors/src/github-app.ts`                  |
| `GITHUB_APP_PRIVATE_KEY`      | Secret | No                   | GitHub App private key.                                             | `packages/connectors/src/github-app.ts`                  |
| `GITHUB_WEBHOOK_SECRET`       | Secret | No                   | GitHub webhook signature secret.                                    | `apps/web/src/auth.ts`                                   |
| `SLACK_CLIENT_ID`             | Var    | No                   | Slack OAuth client id.                                              | `packages/connectors/src/oauth.ts`                       |
| `SLACK_CLIENT_SECRET`         | Secret | No                   | Slack OAuth client secret.                                          | `packages/connectors/src/oauth.ts`                       |
| `DISCORD_CLIENT_ID`           | Var    | No                   | Discord install client id.                                          | `apps/web/src/lib/server/discord-install.ts`             |
| `DISCORD_CLIENT_SECRET`       | Secret | No                   | Discord client secret.                                              | `apps/web/src/lib/server/env.ts`                         |
| `DISCORD_BOT_TOKEN`           | Secret | No                   | Discord bot token for connector calls.                              | `packages/connectors/src/discord/services.ts`            |
| `DISCORD_PUBLIC_KEY`          | Var    | No                   | Discord interaction signature key.                                  | `apps/web/src/lib/server/env.ts`                         |
| `DISCORD_BOT_PERMISSIONS`     | Var    | No                   | Permission integer for the Discord install link.                    | `apps/web/src/lib/server/discord-install.ts`             |
| `RESEND_API_KEY`              | Secret | Yes in deployed Workers | Sends email, such as issue-assignment mail.                     | `apps/web/src/lib/server/email/issue-assignment.ts`      |
| `EXA_API_KEY`                 | Secret | No                   | Web search for agent web tools. Without it, the tools report an unconfigured error. | `packages/agent-runtime/src/agent-tools/web.ts` |
| `AI_GATEWAY_ID`               | Var    | Yes in deployed Workers | AI Gateway that routes Workers AI calls. Set from `aiGatewayId` in `deploy-targets.mjs`. | `packages/agent-runtime/src/run-sub-agent-base.ts` |
| `SANDBOX_TRANSPORT`           | Var    | Yes                  | Sandbox transport. Default `rpc`.                                   | `apps/web/src/lib/server/env.ts`                         |
| `SANDBOX_LOG_LEVEL`           | Var    | No                   | Sandbox log level. Default `warn`.                                  | `packages/observability/src/observability/logger.ts`     |
| `GARDEN_LOG_LEVEL`            | Var    | No                   | Garden structured log level. Default `warn`.                        | `packages/observability/src/observability/logger.ts`     |
| `VITE_PUBLIC_POSTHOG_PROJECT_TOKEN` | Var | Yes in deployed Workers | PostHog project token for browser and Worker events.          | `packages/observability/src/analytics/client.ts`         |
| `VITE_PUBLIC_POSTHOG_HOST`    | Var    | Yes in deployed Workers | PostHog host.                                                    | `packages/observability/src/analytics/client.ts`         |

"Pair, optional" means `optionalCredentialPairIsConfigured` in `deploy-env.mjs` requires both values or neither. "No" GitHub and Slack values are bound only when the deploy environment sets them. `alchemy.run.ts` does not bind the `DISCORD_*` values.

## GitHub App URLs per environment

Each deployed environment needs three URLs in the GitHub App settings (**Settings → Developer settings → GitHub Apps → the App → General**). Replace `<origin>` with the environment's web origin, for example `https://garden-dev.flow-research.workers.dev`.

| App setting | Value | Used by |
| --- | --- | --- |
| Identifying and authorizing users → **Redirect URI** | `<origin>/api/github/callback` | Link with GitHub (`apps/web/src/routes/api/github/identity/`). Without it, GitHub rejects the sign-in with a `redirect_uri` error. |
| Post installation → **Setup URL** | `<origin>/api/github/callback` | App installation from Connectors (`apps/web/src/routes/api/github/setup.ts`). |
| Webhook → **Webhook URL** | `<origin>/api/github/webhook` | Issue and pull request sync (`apps/web/src/routes/api/github/webhook.ts`). |

Leave **Request user authorization (OAuth) during installation** off. Linking a member's GitHub account is a separate step in Settings → Account.

## Offline model variables

`apps/web/wrangler.jsonc` declares these as empty `vars` so that `pnpm dev:offline` can pass them through. Deployed Workers do not set them. `packages/agent-runtime/src/model.ts` reads them.

| Name                                 | Purpose                                                |
| ------------------------------------ | ------------------------------------------------------ |
| `GARDEN_OFFLINE`                     | Turns on offline mode.                                 |
| `GARDEN_MODEL_PROVIDER`              | Model provider, such as `openai-compatible`.           |
| `GARDEN_MODEL_BASE_URL`              | Base URL of the model endpoint.                        |
| `GARDEN_MODEL_ID`                    | Model id.                                              |
| `GARDEN_MODEL_API_KEY`               | Model API key.                                         |
| `GARDEN_MODEL_CONTEXT_WINDOW_TOKENS` | Context window size in tokens.                         |

## Build and deploy variables

These variables are read by deploy tooling, not by the Worker at runtime.

| Name                         | Purpose                                                                   | Read in                                         |
| ---------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------- |
| `GARDEN_DEPLOY_TARGET`       | Selects `staging`, `dev`, or `preview`.                                   | `deploy-targets.mjs` (`deploymentTargetFromEnv`) |
| `WORKERS_CI_BRANCH`          | Branch name from Cloudflare Workers Builds.                               | `scripts/deploy-ci.mjs`, `deploy-targets.mjs`    |
| `CLOUDFLARE_API_TOKEN`       | Cloudflare API token. `CF_API_TOKEN` is accepted as an alias.             | `alchemy.run.ts`                                |
| `CLOUDFLARE_ACCOUNT_ID`      | Cloudflare account id. `CF_ACCOUNT_ID` is accepted as an alias.           | `alchemy.run.ts`                                |
| `ALCHEMY_TELEMETRY_DISABLED` | Set to `1` by every `deploy:*` script.                                    | Alchemy                                         |
| `GARDEN_REQUIRE_POSTHOG`     | When `1`, the Vite build uploads source maps to PostHog and fails without credentials. | `apps/web/vite.config.ts`              |
| `POSTHOG_CLI_API_KEY`        | PostHog personal API key for source-map upload.                           | `apps/web/vite.config.ts`                       |
| `POSTHOG_CLI_PROJECT_ID`     | PostHog project id for source-map upload.                                 | `apps/web/vite.config.ts`                       |
| `POSTHOG_HOST`               | PostHog host for source-map upload.                                       | `apps/web/vite.config.ts`                       |
| `POSTHOG_RELEASE_VERSION`    | Release version tag for uploaded source maps.                             | `apps/web/vite.config.ts`                       |

## Local `.env`

`.env.example` at the repository root lists the local values. Copy it to `.env`. Local defaults:

- `BETTER_AUTH_URL=http://localhost:3000`
- `DATABASE_URL=postgresql://garden:garden@localhost:55432/garden`, the Postgres container from `pnpm offline:up`
- `HELIX_URL=http://localhost:6968`, the HelixDB container from `pnpm offline:up`
- `ENVIRONMENT=development`

Generate `BETTER_AUTH_SECRET` and `EXECUTOR_SECRET_KEY` with `openssl rand -base64 32`.
