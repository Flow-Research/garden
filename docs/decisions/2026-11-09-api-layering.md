---
title: Keep TanStack API routes thin with Zod, queries, and Result services
description: Decision record for layering Garden's TanStack Start `/api` routes as Zod validation, Drizzle queries, better-result services, and thin route handlers — without adding Hono.
status: decision
owner: "@Umoren"
last_reviewed: 2026-11-10

---

**Date:** 2026-11-09. **Outcome:** accepted; migration on `refactor/api-layering`. Decision doc, warn-level lint, `/api/issues` reference, and the issues-children batch (issue `$id` routes, search, child-progress, comments) are in. Next domain batches remain. Not fully shipped yet.

## Context

Most Garden HTTP endpoints are TanStack Start file routes under `apps/web/src/routes/api/`. A smaller set uses Effect `HttpApi` behind `/api/$` ([Effect HttpApi decision](./2026-07-effect-http-api.md)).

About fifty TanStack API route files still import `drizzle-orm` or open the database inside the handler. Auth, Zod parsing, SQL, domain rules, and HTTP mapping sit in one file. That makes routes hard to test, duplicates query shapes, and fights the existing halfway pattern:

- Zod request schemas already live in `apps/web/src/lib/server/validation/`.
- Issue and automation orchestration already lives in `@garden/server` (`packages/server`) and returns `better-result` `Result` values.
- `GET /api/issues` is the reference extract; `POST /api/issues` already calls `createIssue` in `@garden/server`.

Garden needs one layering rule for the remaining TanStack routes so later domain batches copy a template instead of inventing a third style.

## Decision

Garden layers TanStack Start API routes as:

```text
TanStack route
  -> auth / workspace context
  -> Zod (apps/web/src/lib/server/validation/)
  -> service (prefer packages/server/src/{domain}/, better-result Result)
  -> query (apps/web/src/lib/server/queries/{domain}/, Drizzle only)
  -> map Result to Response (.match / serviceErrorResponse)
  -> side effects after a successful write (realtime, analytics, jobs)
```

Locked rules:

| Layer | Home | Owns |
| --- | --- | --- |
| Router | `apps/web/src/routes/api/**` | Auth, parse Zod, call service, map `Result` to `Response`. No `drizzle-orm` and no `db` imports. |
| Validation | `apps/web/src/lib/server/validation/` | Request/search/body Zod schemas shared by routes. |
| Queries | `apps/web/src/lib/server/queries/{domain}/` | Pure Drizzle reads/writes and optional transactions. No HTTP types. |
| Services | Prefer `packages/server/src/{domain}/`; web-boundary helpers in `apps/web/src/lib/server/{domain}/` | Domain orchestration and product outcomes as `Result.ok` / `Result.err`. Group by domain folder; leave shared infra flat (`db.ts`, `context.ts`, `control-plane.ts`, …). |
| Side effects | Called from the route after success | Realtime publish, email, analytics, `waitUntil` run starts. |

Additional locks:

- **TanStack Start file routes only** for this surface. Do not add a second HTTP framework beside Start and the existing Effect `HttpApi` splat.
- **Services return `better-result` `Result`.** Routes map at the boundary. Do not throw domain errors from services.
- **Effect `HttpApi` splat stays** for the groups already on it (`skills`, `documentArtifacts`). This decision does not migrate those groups onto Zod+query+service, and it does not move ordinary CRUD onto the splat.
- **Browser clients stay in `apps/web/src/lib/api/`.** That folder is not the server validation or service layer.
- **Schema migrations stay unchanged.** This refactor should not need a migration unless a later batch discovers a real schema bug.
- **Lint ratchet:** ban `drizzle-orm` and db imports under `apps/web/src/routes/api/` as **warn** first, then **error** once domain batches clear the backlog.
- **Reference route:** `/api/issues` first. Later batches go by domain to `dev`, not a long-lived parallel product branch.

## Consequences

New and migrated TanStack API code follows the table above. `GET /api/issues` is the reference: `listWorkspaceIssues` in `apps/web/src/lib/server/issues/list-service.ts` over `queries/issues`, mapped with `.match()`. `POST /api/issues` calls `createIssue` in `@garden/server` and uses `isTeamAssigneeMember` from `queries/issues` for the remaining Team membership check. Issue child routes under `routes/api/issues/` and `routes/api/comments/` follow the same pattern (no `drizzle-orm` / `@/lib/server/db` / `@garden/db` imports). Other flat `issue-*.ts` / domain files under `lib/server/` move into `{domain}/` folders gradually; do not mass-move them in one PR.

Warn-level lint will flag remaining Drizzle imports in `routes/api/` until each domain batch moves them. Promoting the rule to error is a later phase after the backlog is gone or allowlisted down to empty.

Contributors should not add new inline Drizzle in route handlers. If a route needs SQL, add or extend a query module and, when there is orchestration, a `@garden/server` (or existing `lib/server`) service that returns `Result`.

## Migration shape

1. This decision document.
2. Lint warn for `drizzle-orm` / db imports under `routes/api/`.
3. `/api/issues` as the reference (queries + thin route; reuse `@garden/server` where it already owns writes).
4. Domain batches: issues children → workspaces/members → agents → connections → documents → github/webhooks/misc.
5. Lint error once the route tree is clean.
6. Handbook / architecture cross-links when the reference pattern is live.

## Sources

- Maintainer direction on TanStack + `better-result` (no Hono) for this migration
- Phase 0 locks on `refactor/api-layering`
- [Effect HttpApi decision](./2026-07-effect-http-api.md)
- [HTTP API concept](../concepts/architecture/http-api.md)
- Existing validation at `apps/web/src/lib/server/validation/`
- Existing services at `packages/server/src/issues/` and `packages/server/src/automations/`
- Current reference gap: `apps/web/src/routes/api/issues.ts`
