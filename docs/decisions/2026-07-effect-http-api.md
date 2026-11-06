---
title: Serve typed APIs through one Effect HttpApi behind /api/$
description: Decision record for mounting Garden's skills API, and later other typed APIs, as one Effect HttpApi behind a TanStack Start splat route.
status: decision
owner: "@Umoren"
last_reviewed: 2026-11-03
---

**Date:** 2026-07-25. **Outcome:** shipped for the `skills` group, then extended to `documentArtifacts`.

## Context

The skills HTTP surface needed typed contracts, validation, typed errors, and a generated client. The first approach wrapped each endpoint in its own transport Effect and a custom runner. Every endpoint repeated request decoding, an error-to-status switch, and `Response.json`.

Garden runs on Cloudflare Workers inside TanStack Start, and request-created I/O must stay inside one request. Any design had to keep `AppRequestContext` as the owner of the database and auth state.

## Decision

Garden implements typed HTTP surfaces as one Effect `HttpApi` mounted behind the TanStack Start splat route `createFileRoute('/api/$')`. `HttpRouter.toWebHandler` is the only server execution boundary. Each request builds its Layers from the current `AppRequestContext`, and the `Database` service borrows `AppRequestContext.db()`.

On the client, one shared `ManagedRuntime` and one `runClientEffect` function bridge generated-client Effects to TanStack Query Promises.

## Rejected options

Garden rejected these designs:

- A transport Effect and custom runner per endpoint, with manual decoding, status switches, and `Response.json`. Effect HttpApi already owns those jobs.
- TanStack `createServerFn` for the skills API.
- A feature-owned PostgreSQL client or Effect SQL pool.
- Module-global request services, or I/O created at module scope.
- Manual `Schema.encodeEffect` inside handlers.
- `FiberRef` or mutable global request context when explicit request context exists.
- The `effect-query` library. Its wrapped failures make TanStack Router `redirect()` and `notFound()` harder to use in loaders, and Garden needs only a small adapter.
- The direct SSR client from `EthanShoeDev/effect-tanstack-start`, until Garden proves the request-context path for it. Its mount helper supplies a process-level runtime instead of Garden's `AppRequestContext`.

## Consequences

Each new typed group adds a contract file in `apps/web/src/lib/api/` and a handler Layer, and joins `GardenApi` in `garden-api-contract.ts`. When documents joined, the two groups first collided as competing catch-all handlers. Composing them into one `GardenApi` contract fixed that.

Exact TanStack routes and the splat coexist. Exact routes win, so migration can go one endpoint at a time, but tests must cover route precedence.

Effect at the time turned JSON parse failures into defects, so Garden added one router middleware that maps `SyntaxError` defects to 400. It stays until Effect reports malformed JSON as a schema error.

The current pattern is explained in [the HTTP API page](../concepts/architecture/http-api.md).

## Evidence consulted

These public projects shaped the decision:

- [EthanShoeDev/effect-tanstack-start](https://github.com/EthanShoeDev/effect-tanstack-start) mounts Effect HttpApi at `/api/$` with one `toWebHandler` handler for all methods.
- [lucas-barake/effect-tanstack-start](https://github.com/lucas-barake/effect-tanstack-start) separates the API contract from `HttpApiBuilder.group` implementations behind one `/api/$` route.
- [backpine/effect-worker](https://github.com/backpine/effect-worker) shows per-request services on Workers and why database I/O must not be shared between requests.
- [voidhashcom/effect-query](https://github.com/voidhashcom/effect-query) bridges Effects to TanStack Query through one `ManagedRuntime`.
- [Effect HttpApi source](https://github.com/Effect-TS/effect/tree/main/packages/effect/src/unstable/httpapi) confirms `HttpApiTest.groups`, `HttpRouter.provideRequest`, and request context on `HttpRouter.toWebHandler`.
- [TanStack Start server routes](https://tanstack.com/start/latest/docs/framework/react/guide/server-routes) and [Hyperdrive connection lifecycle](https://developers.cloudflare.com/hyperdrive/concepts/connection-lifecycle/).
