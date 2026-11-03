---
title: Find a problem in the Worker logs
description: Query Cloudflare Workers Logs to find errors, failed requests, and Garden log events in a deployed Garden Worker.
status: current
owner: "@Umoren"
last_reviewed: 2026-11-03
---

Garden logs to Cloudflare Workers Logs. Start with the app Worker for the target: `garden-staging`, `garden-dev`, or `garden-preview`. Connector APIs and Executor MCP Durable Objects run inside that Worker, so their logs are there too. For build and deploy logs, see [Deploy targets](../../reference/deploy-targets.md).

## Query the app Worker

1. In the Cloudflare dashboard, open **Workers & Pages**, then **Observability**.
2. Select the app Worker, such as `garden-staging`.
3. Add one of these filters:

```text
$metadata.service = "garden-staging"
$metadata.error EXISTS
$workers.outcome = "exception"
$workers.event.response.status >= 500
$metadata.level = "error"
message : "auth.session.lookup_failed"
event = "auth.session.lookup_failed"
$workers.event.request.path = "/api/inbox"
```

4. To see one request with its logs, open **Invocations**. To see rows in time order, open **Events**.
5. Add columns for `event`, `message`, `component`, `requestId`, `$workers.event.request.path`, `$workers.event.response.status`, and `$metadata.error` when you debug app errors.

## Skip the tail Worker for normal debugging

Each target also deploys a tail Worker, such as `garden-staging-tail`, from `workers/tail-observer/src/index.ts`. It receives the app Worker's trace events after each invocation and writes short summary rows. Query the app Worker for errors. Use the tail Worker only for those summaries.

Its invocation rows always carry the message `tail`. `workers/tail-observer/wrangler.jsonc` turns invocation logs off, but `alchemy.run.ts` deploys the tail Worker with `invocationLogs: true`, so filter those rows out.

## See debug and info logs

Deployed Workers default `GARDEN_LOG_LEVEL` to `warn`, so Garden drops `debug` and `info` records and keeps warnings and errors. `apps/web/wrangler.jsonc` sets the same default for local development. To see more locally, set `GARDEN_LOG_LEVEL` to `info` or `debug` in your environment and restart Garden.

## Search by event name

`createGardenLogger` in `packages/observability/src/observability/logger.ts` emits structured JSON with both `event` and `message` set to the Garden event name. Filter on `event` in queries. The app Worker logs with `service: 'garden-staging'` on every target, so `$metadata.service = "garden-staging"` also matches dev and preview logs. `message` shows the event name in the row list without expanding each row.
