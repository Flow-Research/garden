---
title: Run Garden locally and watch an agent work an issue
description: Go from a fresh clone to a running Garden app on a local model, then follow one issue run from the board to the durable Workflow.
status: current
owner: "@Umoren"
last_reviewed: 2026-11-03
---

In this tutorial, we clone Garden, run it on your machine with a local model, and give an issue to the default agent. At the end, you have a working checkout and you have watched one issue run go from **In Progress** to a finished run.

You need basic TypeScript knowledge. You do not need a Cloudflare account. The local-model mode runs Postgres, HelixDB, and Ollama in Docker, and simulates D1, R2, Durable Objects, and Workflows on your machine.

## Before you start

Install these tools:

- Node.js 22.12 or newer
- Docker Desktop or another Docker engine
- Corepack, which ships with Node.js

## Step 1: clone and install

Run:

```bash
git clone https://github.com/Flow-Research/garden.git
cd garden
corepack enable
corepack install
pnpm install --frozen-lockfile
```

You should see pnpm finish with a `Done` line and no lockfile errors. Corepack installs pnpm 10.33.0, the version pinned in `package.json`.

## Step 2: create your `.env`

Copy the example file:

```bash
cp .env.example .env
```

Now generate two secrets:

```bash
openssl rand -base64 32
openssl rand -base64 32
```

You should see two different base64 strings. Put the first one in `BETTER_AUTH_SECRET` and the second one in `EXECUTOR_SECRET_KEY` in `.env`. Leave the other values as they are. Connector and PostHog values are optional for local work.

Never commit `.env` or paste its values into an issue, a pull request, or a chat.

## Step 3: start the local services

We run Postgres, HelixDB, and Ollama in Docker, then pull the model:

```bash
pnpm offline:up:ollama
docker compose -f compose.dev.yaml exec ollama ollama pull qwen3:8b
```

You should see three healthy containers: Postgres on port `55432`, HelixDB on port `6968`, and Ollama on port `11434`. The model download is about 5 GB.

If you already run Ollama natively, run `ollama pull qwen3:8b` and then `pnpm offline:up` instead. That command starts only Postgres and HelixDB.

## Step 4: create the database tables

Run:

```bash
pnpm --filter @garden/db db:migrate
```

You should see Drizzle Kit apply the migrations in `packages/db/drizzle/` and exit without errors.

## Step 5: start Garden

Run:

```bash
pnpm dev:offline
```

You should see the Turbo terminal UI start `@garden/web`. When Vite prints its ready line, open [http://localhost:3000](http://localhost:3000).

Create an account, then create a workspace. Garden creates a default agent named **Garden** in the new workspace.

Send one chat message to the agent. You should see a streamed reply from `qwen3:8b`. Your local checkout now works end to end.

## Step 6: give an issue to the agent

Now we start an issue run:

1. Open the issues board and create an issue. Give it a short, concrete task, such as "List three risks of moving the team standup to Fridays."
2. Set **Assignee** to the **Garden** agent.
3. Set **Status** to **In Progress**.

Garden starts a run when an issue is assigned to an agent and its status is not `todo`, `done`, or `cancelled`. You should see the run appear on the issue with the status `queued`, then `running`. When the agent finishes, the status changes to `succeeded`, and the agent's reply appears in the issue timeline.

If the run ends in `failed`, open the run details on the issue to read the reason.

## Step 7: follow the run through the code

The run you just watched took this path:

```text
POST /api/issues/$id/runs, or an issue update that assigns an agent
  -> startIssueRun()                        packages/server/src/issues/run-service.ts
  -> AgentDO.startIssueRunWorkflow()        packages/agent-runtime/src/agent-do.ts
  -> RunWorkflow                            packages/agent-runtime/src/run-workflow.ts
  -> IssueRunSubAgent.executeWorkflowTurn() packages/agent-runtime/src/issue-run-sub-agent.ts
```

Open `packages/server/src/issues/run-service.ts` and find `startIssueRun`. It writes the `issue_run` row to Postgres before anything else runs. Then open `packages/agent-runtime/src/agent-do.ts` and find `startIssueRunWorkflow`. It starts the `RUN_WORKFLOW` binding with the run id as the Workflow instance id, which is what stops a second start of the same run.

`RunWorkflow` owns retries, waits, resume, and cancellation. `IssueRunSubAgent` does the agent work for one turn and reports the result back to the Workflow.

## What you built

You have a local Garden checkout running on a local model, and you have followed one issue run from the board to the durable Workflow.

Next:

- To see how the pieces fit together, read [How Garden is built](../concepts/architecture/how-garden-is-built.mdx) and [Run engine](../concepts/architecture/run-engine.md).
- To use Workers AI instead of Ollama, or if a step failed, see [Fix setup problems](../guides/develop/fix-setup-problems.md).
- To make your first change, read [`AGENTS.md`](../../AGENTS.md), then follow [Ship a change](../guides/develop/ship-a-change.mdx) and [Run the tests](../guides/develop/run-tests.md).
