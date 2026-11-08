---
title: Fix local setup problems
description: Diagnose and fix the common failures when you run Garden locally, and switch the model to Workers AI.
status: current
owner: "@Umoren"
last_reviewed: 2026-11-03
---

Use this page when a step in [Run Garden locally](../../tutorials/get-started.md) fails.

## Postgres does not start

1. Confirm that Docker is running.
2. Start the services again:

   ```bash
   pnpm offline:up
   ```

Local Postgres uses host port `55432`. If another process uses that port, change the port mapping in `compose.dev.yaml` and the port in `DATABASE_URL` in `.env`.

## The local model does not respond

Check that the endpoint answers and that the model is installed:

```bash
curl http://localhost:11434/v1/models
ollama list
```

If Ollama runs in Docker, list the models inside the container:

```bash
docker compose -f compose.dev.yaml exec ollama ollama list
```

If `qwen3:8b` is missing, pull it. To use a different model or a hosted OpenAI-compatible endpoint, set `GARDEN_MODEL_BASE_URL`, `GARDEN_MODEL_ID`, and `GARDEN_MODEL_API_KEY` in `.env`. The commented block at the end of `.env.example` shows the format.

## Use Workers AI instead of a local model

Workers AI has no local simulator, so `pnpm dev` sends model calls to Cloudflare. You need a Cloudflare account on the Workers paid plan. The default model, `@cf/moonshotai/kimi-k2.7-code`, is not available on the free plan. Usage can create charges.

1. Sign in and print your account id:

   ```bash
   pnpm --filter @garden/web exec wrangler login
   pnpm --filter @garden/web exec wrangler whoami
   ```

2. Put the account id in `CLOUDFLARE_ACCOUNT_ID` in `.env`.
3. Start the services, migrate, and run Garden:

   ```bash
   pnpm offline:up
   pnpm --filter @garden/db db:migrate
   pnpm dev
   ```

## Workers AI does not respond

Run `wrangler whoami` again. Confirm that `CLOUDFLARE_ACCOUNT_ID` matches the signed-in account. If the account is not on the Workers paid plan, use `pnpm dev:offline`.

## A connector is unavailable

Connector credentials are optional in local development. Add only the values that the connector needs, such as `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`, then restart Garden. [Environment variables and Worker bindings](../../reference/environment-and-bindings.md) lists every connector variable.

## Port 3000 is already in use

Stop the process that owns port 3000.

`pnpm dev:reset` stops dev processes by name. It matches any `turbo run dev`, `vite dev`, `workerd serve`, or `esbuild --service` process, so it can stop processes from other projects too.

## Run the doctor script

`pnpm doctor` runs `scripts/garden-doctor.mjs`, which checks the local setup. Run it when the cause is unclear.
