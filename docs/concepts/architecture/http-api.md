---
title: One Effect HttpApi serves the /api splat route
description: How Garden mounts typed Effect HttpApi groups behind the TanStack Start `/api/$` route, and how requests, the database, and TanStack Query fit around it.
status: current
owner: "@Umoren"
last_reviewed: 2026-11-10
---

Most Garden API endpoints are plain TanStack Start server routes under `apps/web/src/routes/api/`. A growing set uses a different pattern: a typed Effect `HttpApi` contract mounted behind one splat route, `apps/web/src/routes/api/$.ts`. This page explains that pattern. The [Effect HttpApi decision](../../decisions/2026-07-effect-http-api.md) records why Garden chose it.

## Which groups the splat serves

`GardenApi` in `apps/web/src/lib/api/garden-api-contract.ts` composes two groups:

- `skills`, from `apps/web/src/lib/api/skills-contract.ts`. It covers `/api/skills`, `/api/skills/:id`, `/api/skills/import`, `/api/skills/search`, `/api/skills/preview`, and `/api/agents/:id/skills`.
- `documentArtifacts`, from `apps/web/src/lib/api/document-artifact-contract.ts`. It covers `/api/documents/:id/artifact` and `/api/documents/:id/artifact/events`.

Exact TanStack routes take precedence over the splat. A request reaches `/api/$` only when no exact route matches it.

## A request passes through one handler

A request takes this path:

```text
Cloudflare Worker request
  -> TanStack Start server entry and request context
  -> createFileRoute('/api/$').server.handlers
  -> gardenApiWebHandler (HttpRouter.toWebHandler)
  -> the matching HttpApi group handler
  -> request-scoped Layers
  -> application services such as Skills
  -> AppRequestContext.db()
```

`apps/web/src/routes/api/$.ts` is a thin host. For each method it calls `requireAppRequestContext`, builds the Effect context with `makeGardenApiRequestContext`, and passes the request to `gardenApiWebHandler`. Both functions live in `apps/web/src/lib/server/garden-api.server.ts`. The `.server.ts` suffix keeps that module out of browser bundles.

Each tool owns one concern:

| Concern | Owner |
| --- | --- |
| Worker integration, route hosting, SSR, and hydration | TanStack Start |
| HTTP contracts, validation, encoding, typed errors, and generated clients | Effect HttpApi |
| Application composition | Effect services and Layers |
| Cache, invalidation, optimistic state, prefetch, and dehydration | TanStack Query |
| Request-local database resources | Garden `AppRequestContext` |

## The contract is written once

Each group declares the method, path, inputs, success schema, and errors for every endpoint. From that contract, Effect HttpApi decodes the path, query, headers, and payload. It hands typed inputs to the handler, so domain code never sees `unknown`. It encodes the declared success and error values, builds the `Response` with the declared status, and derives a typed client.

Domain error classes stay free of HTTP. The contract adds HTTP statuses to their schemas, so `Skills` never handles a `Request`, a `Response`, or a status code. Effect Schema is the public model, and API TypeScript types come from the schemas.

Handlers form one `HttpApiBuilder.group` Layer per group and get services by yielding them. No handler builds its own infrastructure. `gardenApiRouterLayer` merges the group handlers into one router.

## Request I/O stays inside the request

Cloudflare can reuse one isolate for concurrent requests, but I/O objects created during one request cannot be used by another. Garden keeps the existing request owner, `AppRequestContext`, which holds the env, the `Request`, auth state, a `db()` provider, and cleanup.

The split looks like this:

```text
module scope (static)
  -> schemas, service tags, Layer recipes, the API contract, the router

per request
  -> AppRequest service
  -> Database service that borrows context.db()
  -> Skills and document artifact services, then the endpoint
```

`HttpRouter.toWebHandler` accepts request-scoped requirements. The route builds `requestGardenApiLayer` from the current `AppRequestContext` and passes the result into the static handler. The `Database` service borrows `AppRequestContext.db()`. It does not open another client or pool.

## Malformed JSON returns 400

Effect turns a JSON parse failure into a defect, which would return 500. `malformedJsonMiddleware` in `garden-api.server.ts` catches only `SyntaxError` defects and returns 400. Remove it once Effect reports malformed JSON as a schema error.

## TanStack Query sits on one Promise boundary

TanStack Query needs Promises. Generated HttpApi client methods return lazy `Effect` values. `apps/web/src/lib/api/skills.ts` bridges the web consumer to generated clients.
The skills-list read uses `skills-client.ts`, which binds an explicit origin,
workspace and session to a host-supplied Fetch transport. Session invalidation
aborts pending reads and rejects late results. The web adapter handles cookie
credentials and account/workspace changes. Other skills operations retain the
browser `ManagedRuntime` and `runClientEffect` boundary. Generated clients are
cached per transport, so reconfiguration does not retain the first origin. See
[the session decision](../../decisions/2026-11-shared-client-session.md).

TanStack Query keeps its existing jobs: query keys and invalidation, optimistic updates, freshness, `ensureQueryData` prefetch, and dehydration. Values stored in Query stay plain JSON. The API transport is HTTP JSON. Seroval takes part only when Query state is dehydrated for SSR.

## Test at three levels

The pattern supports three kinds of test:

- `HttpApiTest.groups` runs the full encode, route, and decode pipeline in memory with replacement Layers. Use it for schemas, declared errors, handlers, and middleware.
- Raw `Request` tests build the real web handler with test Layers and send a real `Request`. Use them for status codes, headers, malformed JSON, and auth.
- Route tests check that `/api/$` forwards the method, body, headers, and request context, and that exact routes keep precedence.

## Serialization rules

These rules keep the contract honest:

- Decode untrusted input at the boundary that owns it.
- Keep public success and error schemas JSON-safe.
- Let HttpApi encode responses. Do not call `Schema.encodeEffect` in handlers.
- Declare every public field in the schema. `Schema.Struct` drops undeclared fields when it encodes.
- Use `{ onExcessProperty: 'error' }` on inputs where an unknown key must fail.

## Proposed native clients reuse this boundary

The [cross-platform client proposal](../../proposals/cross-platform-clients.md) maps the current transport, sign-in, chat and authority boundaries. The agreed client scope does not make every product route part of `GardenApi`. Extend the existing contract only for required operations; keep browser/native transport and session adapters outside domain contracts. Native authentication and lifecycle behavior still need implementation and device proof.
