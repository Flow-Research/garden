# Set up Garden for local development

Garden is an open-source workspace where people and AI agents manage shared
work. This guide takes a new contributor from a fresh clone to a working local
app. It then explains the main system boundaries, traces one issue run, and
shows how to verify a change. You need basic TypeScript and React knowledge.
You do not need prior Cloudflare experience.

## Choose a local development mode

Garden supports two model configurations. Both configurations keep the web
app, Postgres database, D1 database, R2 storage, Durable Objects, and Workflows
on your machine.

| Mode | Model location | Account required | Command |
| --- | --- | --- | --- |
| Local model | Ollama on your machine | No | `pnpm dev:offline` |
| Workers AI | Cloudflare Workers AI | Cloudflare paid plan | `pnpm dev` |

Use the local-model configuration for your first run. Use Workers AI only when
you need to test the deployed model path.

## Install the prerequisites

You need:

- Node.js 22.12 or newer;
- pnpm 10.33.0, installed through Corepack; and
- Docker Desktop or another Docker engine.

Docker runs the local Postgres database. It can also run Ollama if you do not
want to install Ollama on your computer.

## Clone and install Garden

Run these commands from a terminal:

```bash
git clone https://github.com/Flow-Research/garden.git
cd garden
corepack enable
corepack install
pnpm install --frozen-lockfile
```

The repository pins its pnpm version in `package.json`. The frozen lockfile
keeps your installed dependencies equal to `pnpm-lock.yaml`.

## Create the local environment

Copy the example environment file:

```bash
cp .env.example .env
```

Generate two different secrets:

```bash
openssl rand -base64 32
openssl rand -base64 32
```

Add the first value to `BETTER_AUTH_SECRET` in `.env`. Add the second value to
`EXECUTOR_SECRET_KEY`.

The other values already have local defaults. Connector credentials and
PostHog values are optional during local development. Never commit `.env` or
paste its values into an issue, pull request, or chat message.

## Start Garden with a local model

Ollama provides the local model. Choose one Ollama installation method.

### Run Ollama in Docker

Start Postgres and Ollama:

```bash
pnpm offline:up:ollama
docker compose -f compose.dev.yaml exec ollama ollama pull qwen3:8b
```

The model download is approximately 5 GB.

### Run Ollama on your computer

Install Ollama from [ollama.com](https://ollama.com). The native application is
usually faster than Docker on Apple silicon because it can use the Mac GPU.
Then run:

```bash
ollama pull qwen3:8b
pnpm offline:up
```

This command starts only Postgres in Docker.

### Migrate the database and start the app

```bash
pnpm --filter @garden/db db:migrate
pnpm dev:offline
```

Open [http://localhost:3000](http://localhost:3000). Create an account, then
create a workspace. Send one chat message to confirm that the local model can
complete a turn.

At this point, you have a working Garden checkout.

## Use Workers AI when required

Workers AI has no local simulator. This configuration sends only model calls
to Cloudflare. It requires a Cloudflare account on the Workers paid plan.

Sign in and find your account ID:

```bash
pnpm --filter @garden/web exec wrangler login
pnpm --filter @garden/web exec wrangler whoami
```

Add the reported account ID to `CLOUDFLARE_ACCOUNT_ID` in `.env`. Then run:

```bash
pnpm offline:up
pnpm --filter @garden/db db:migrate
pnpm dev
```

Workers AI usage can create charges on your Cloudflare account. The default
model, `@cf/moonshotai/kimi-k2.7-code`, is not available on the free plan.

## Understand the system boundaries

Garden runs as one TanStack Start web Worker. The Worker contains the web app,
API routes, Executor connector surfaces, and agent entry points. There is no
separate connector service or Model Context Protocol (MCP) proxy to start.

```text
Browser
  -> TanStack Start Worker
       -> Neon or local Postgres: shared product data
       -> D1: Executor data
       -> R2: files and binary objects
       -> Durable Objects: agent and MCP session state
       -> Cloudflare Workflows: durable issue and automation runs
       -> model provider: Ollama, another OpenAI-compatible API, or Workers AI
```

Use these directories to find the owner of a change:

| Directory | Responsibility |
| --- | --- |
| `apps/web` | Web interface, API routes, authentication, and Worker entry point |
| `packages/agent-runtime` | Agents, tools, model calls, and durable run coordination |
| `packages/db` | Drizzle schema, migrations, and Postgres access |
| `packages/connectors` | Connector definitions, policies, and native integrations |
| `packages/core` | Shared product types and services |
| `packages/app-state` | Client application state |
| `packages/ui` | Shared interface components |

Read `docs/core/technical.md` for the detailed architecture.

## Trace an issue run

An issue run moves from an HTTP request into a Cloudflare Workflow. A Workflow
is a durable process that can retry, wait, resume, and survive restarts.

```text
POST /api/issues/:id/runs
  -> startIssueRun()
  -> AgentDO.startIssueRunWorkflow()
  -> RunWorkflow.run()
  -> IssueRunSubAgent.executeWorkflowTurn()
```

1. The route authenticates the user and checks workspace access.
2. `startIssueRun()` records the run in Postgres and prevents duplicate starts.
3. `AgentDO` starts `RUN_WORKFLOW` with the run ID as the workflow instance ID.
4. `RunWorkflow` owns retries, waits, resume, cancellation, and terminal state.
5. `IssueRunSubAgent` submits the agent turn and reports its result to the
   workflow.

Postgres stores product state. `AgentDO` identifies the agent. `RunWorkflow`
owns durable execution. `IssueRunSubAgent` performs the agent work.

## Make and verify a change

Read `AGENTS.md` before you edit code. It contains repository rules and links
to framework-specific guidance.

Run the checks for the package you changed while you work. For example:

```bash
pnpm --filter @garden/web typecheck
pnpm --filter @garden/web test
```

Before you open a pull request, run the repository checks that cover your
change:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The full test suite uses Testcontainers and requires Docker. Connector changes
also require:

```bash
pnpm verify:connectors
pnpm --filter @garden/connectors typecheck
pnpm --filter @garden/connectors test
```

Keep the pull request focused. Include tests for behavior changes. Update a
shared schema before you update its consumers.

## Fix common setup failures

### Postgres does not start

Confirm that Docker is running. Then run:

```bash
pnpm offline:up
```

Local Postgres uses host port `55432`. If another process uses that port,
change `DATABASE_URL` in `.env` and the port mapping in `compose.dev.yaml`.

### The local model does not respond

Check the endpoint and installed models:

```bash
curl http://localhost:11434/v1/models
ollama list
```

For Docker-based Ollama, use:

```bash
docker compose -f compose.dev.yaml exec ollama ollama list
```

### Workers AI does not respond

Run `wrangler whoami` again. Confirm that `CLOUDFLARE_ACCOUNT_ID` matches the
authenticated account. Use the local-model configuration if the account does
not have the Workers paid plan.

### A connector is unavailable

Connector credentials are optional. Add only the provider values that the
connector needs from `.env.example`, then restart Garden.

### Port 3000 is already in use

Stop the process that owns port 3000. Use `pnpm dev:reset` with care because it
uses broad process-name matching and can stop unrelated Vite, Workerd, or
esbuild processes.
