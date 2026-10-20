# Garden Codebase Audit (October 2026)

**Scope:** the whole monorepo: `apps/web`, the 11 packages under `packages/*`, `workers/tail-observer`, the build and CI tooling, dependencies, the DB schema and migrations, the design system, and the docs.
**Size:** 904 TypeScript files, about 161k lines, with generated files excluded.
**Method:**
- The codebase was split into six areas. Each area was audited independently.
- Every finding with a Critical or High severity was then checked again against the source.
- The audit was read-only. `node_modules` was not installed, so lint, typecheck, tests and `drizzle-kit` were **not run**. Findings that depend on running them are marked *(unverified)*.
- The audit was done without reference to the repository's agent instruction files (`AGENTS.md`, `CLAUDE.md`, `.agents/`, `.claude/`), so it judges the code on its own terms rather than against existing house rules.

> **Security disclosure note.** This audit found several exploitable security issues: authorization gaps, stored XSS, and credential forwarding. They are listed by category in §2 but are **not detailed here**. `SECURITY.md` asks for private disclosure, so those details should go into a GitHub private security advisory, not a public commit.

---

## Contents

1. [Executive summary](#1-executive-summary)
2. [Fix now: confirmed defects](#2-fix-now-confirmed-defects)
3. [Findings by area](#3-findings-by-area)
   - 3.1 [Type safety](#31-type-safety)
   - 3.2 [Conflicting paradigms (errors, validation, schemas)](#32-conflicting-paradigms)
   - 3.3 [API / server layer](#33-api--server-layer)
   - 3.4 [Data layer: schema, migrations, types](#34-data-layer)
   - 3.5 [Agent runtime and connectors](#35-agent-runtime-and-connectors)
   - 3.6 [Frontend architecture](#36-frontend-architecture)
   - 3.7 [Design system](#37-design-system)
   - 3.8 [Config, logging, observability](#38-config-logging-observability)
   - 3.9 [Tooling, CI, dependencies](#39-tooling-ci-dependencies)
   - 3.10 [Tests](#310-tests)
   - 3.11 [Repo hygiene and docs](#311-repo-hygiene-and-docs)
4. [Canonical conventions (one pattern per concern)](#4-canonical-conventions)
5. [Enforcement: lint, tsconfig, CI](#5-enforcement)
6. [Remediation roadmap](#6-remediation-roadmap)
7. [Appendix: metrics](#7-appendix-metrics)

Severity scale: **Critical** means exploitable or causes data loss. **High** means user-visible breakage or a systemic risk. **Medium** means maintainability or latent bugs. **Low** means hygiene.

---

## 1. Executive summary

At the level of individual lines, the code is better than the brief suggested:
- Production `any` is rare: 15 uses outside tests and generated files.
- The core packages have zero `any`.
- The token pipeline and CI token check work.

The real problems are **structural**: several competing ways of doing the same thing, and nothing that enforces one of them.

| Area | Health | Headline |
|---|---|---|
| Security / authz | 🔴 | Role checks are applied to only a few mutating routes. Agent tool permissions mean opposite things in chat and in runs, and fall back to full access. There are also unsafe file serving and credential forwarding issues (see the advisory). |
| Data layer | 🔴 | The migration journal has been hand-edited and is inconsistent. Deleting an issue that has comments fails on a foreign key. Timestamps mix `timestamptz` and `timestamp`. There is no ON DELETE policy. |
| Server/API | 🟠 | There are three API stacks, six error-response shapes, and DB errors returned as 400 with raw Postgres messages. One DB client factory leaks connections and has 48+ call sites. |
| Agent runtime | 🟠 | The issue-run and automation-run agents are about 55–60% copy-paste of each other. There are four error-class styles. Automations scheduled with cron can silently stop forever. |
| Frontend | 🟠 | Some issue links lead to a 404, and internal editor links do nothing. Several components exceed 1,000 lines. Query keys are scattered and duplicated. There are four ways of calling the API. |
| Design system | 🟠 | Three token vocabularies are live at once. 34 font sizes are used against a 10-step scale. There are three icon libraries. About 1,600 lines of dead UI components remain, plus about 8k dead vendored lines. |
| Tooling | 🟠 | Lint runs only the `correctness` category: nothing bans `any`, and no React hook or a11y rules run. CI does not check formatting. The Effect version in the catalog is contradicted by the overrides. Some dependencies are pinned to `latest`. |
| Tests | 🟠 | 77 of 91 API routes and the four largest agent-runtime files have no tests. The 66 web test files are never type-checked. |

**The single highest-leverage change** is to choose the conventions in §4 and turn on the lint and CI enforcement in §5. Without that enforcement, every cleanup will drift back.

---

## 2. Fix now: confirmed defects

Each of these was confirmed by reading the code. Fix them before any refactoring.

| # | Defect | Evidence | Severity |
|---|---|---|---|
| D1 | **Several security vulnerabilities** in authorization, file serving and the internal endpoint. Some can be exploited by any workspace member. | Details in the private advisory. Remediation themes are in §3.3. | Critical |
| D2 | **Agent tool permissions are inconsistent and fail open.** An empty `allowed_tools` list denies every tool in chat but allows every tool in issue and automation runs. Permissions that are missing or fail to parse resolve to `full_access: true`. | `packages/agent-runtime/src/chat-permissions.ts:30` vs `issue-run-sub-agent.ts:1233` (and the automation copy); `issue-run-sub-agent.ts:1228`, `:515`; `packages/core/src/agents/permissions.ts:37-39` | Critical |
| D3 | **Deleting an issue that has comments fails.** `issue_comment.issue_id` is `ON DELETE no action`, and the DELETE route removes the issue row directly. `issue.parent_id` has the same problem. | `packages/db/drizzle/0000_harsh_rick_jones.sql:257`; `apps/web/src/routes/api/issues/$id.ts:325` | High |
| D4 | **The migration journal is corrupt.** `idx: 46` appears twice. `0009.when` is earlier than `0008.when`, and the drizzle migrator orders by `when`. Prefixes 0029 and 0030 are each duplicated. 19 migrations have no snapshot, and the snapshot `prevId` chain breaks after 0016. Several migrations that were already applied were later edited. | `packages/db/drizzle/meta/_journal.json`; commits 78484c2, 2227a95, 836daa4, 6d68536 | High |
| D5 | **Database connection leak.** `createDb` opens a `pg.Client` and returns only `.db`, so the close handle is lost. `getDb()` wraps it, has 48–62 call sites, and never closes. A separate comment says `getPooledDb` memoizes a pool, but it does not. | `packages/db/src/runtime.ts:85-96`; `apps/web/src/lib/server/db.ts:12`; `packages/server/src/issues/server.ts:184-189` | High |
| D6 | **Cron automations can stop permanently.** In `handleScheduledTrigger`, a failure in the concurrency policy or skip-record step returns *before* `scheduleNext`. The caller only logs the error, and each schedule fires once, so a single transient DB error ends the automation silently. | `packages/agent-runtime/src/automation-trigger-do.ts:306-357` | High |
| D7 | **Issue links 404.** Eight places link to `/issues/${id}`, but the route is `/tasks/$issueId` and no `/issues` route exists. | `features/issues/components/issue-detail.tsx:980,1524,1718`, `list-row.tsx:64`, `board-card.tsx:289`, `issue-mention-card.tsx:80`, `features/editor/readonly-content.tsx:93`, `editor/extensions/mention-view.tsx:95` | High |
| D8 | **Internal links in the editor do nothing.** `link-handler.ts` dispatches a `garden:navigate` window event that nothing listens for, and its callers have already called `preventDefault()`. `garden:connections-changed` also has no listener. | `apps/web/src/features/editor/utils/link-handler.ts:11`; `features/connections/events.ts:5` | High |
| D9 | **Issue identifiers depend on the code path.** `toIssue` in control-plane defaults the prefix to `'ISS'`, so list and detail views show different identifiers from creation and search for workspaces with a custom `issuePrefix`. | `apps/web/src/lib/server/control-plane.ts:289`, `:384` | Medium |
| D10 | **DB and storage outages are invisible.** 48 call sites return `badRequest(x.error.message)`, and 8 local mappers turn every service error, including `db_error`, into 400. Raw Postgres messages reach clients. Alerting only fires on 5xx. | e.g. `routes/api/runs/$id.ts:18-20`, `issues/$id/cancel.ts:17-19`; `packages/server/src/issues/server.ts:194-200` | Medium |
| D11 | **Timer cleanup is discarded.** A `clearTimeout` cleanup is returned from inside a `requestAnimationFrame` callback, so React never sees it. | `features/issues/components/issue-detail.tsx:841-854` | Low |
| D12 | **A "skill detached" toast appears even when the request fails.** The rollback runs in `.catch`, but the success toast fires regardless. | `features/agents/components/agent-skills-tab.tsx:94-106` | Low |

---

## 3. Findings by area

### 3.1 Type safety

Production `any` is low. The bigger issue is that nothing stops new `any` from being added: oxlint has no `no-explicit-any` rule.

| Pattern | Production | Tests | Generated |
|---|---|---|---|
| explicit `any` | **15** | 46 | 127 (`routeTree.gen.ts`, ignore) |
| `as unknown as` | ~23 | ~54 | n/a |
| non-null `!.` | ~28 | n/a | n/a |
| `@ts-expect-error` | 1 | n/a | n/a |

**Where the `any` is:**
- `apps/web/src/features/editor/extensions/file-upload.ts:8-65`, `file-card.tsx:110-112`, `mention-extension.ts:56-72`: Tiptap glue, 11 uses. **Fix:** type them as `Editor` (`@tiptap/core`) and `Node` (`@tiptap/pm/model`), and add a typed `MarkdownToken` interface.
- `packages/server/src/automations/run-service.ts:34` and `packages/server/src/issues/run-service.ts:76`: `get: (id: any)` on Durable Object namespaces. **Fix:** a shared `@garden/server/runtime-bindings` module that exports `DurableObjectNamespace<AgentDO>`. This also removes three copies of `AGENT_RUNTIME_NAME_PATTERN` and the duplicated `RunWorkflowBinding`/`HyperdriveConnection` types.
- Tests: `features/issues/components/issues-page.test.tsx` (32), `issue-detail.test.tsx` (12), `modals/create-issue.test.tsx` (2). These all come from re-mocking zustand selectors and UI primitives. **Fix:** one `renderWithProviders()` helper with real stores and a fake `api`, and typed mocks via `vi.mocked()` or `satisfies Partial<…>`.

**Casts that hide real type gaps:**
- AI-SDK message parts are re-cast to `Record<string, unknown>` in five chat files (`chat-artifacts.tsx:163,165`, `chat-message-model.ts:104,147`, `chat-message-parts.tsx:177`, `chat-tool-activity.tsx:137`). **Fix:** one `toPartRecord()` or schema in `chat-message-model.ts`.
- `issue!.` appears 13 times in `issue-detail.tsx:894-1015`, because the ~1,700-line component never narrows `issue`. **Fix:** split it into a loader that returns early and a body that takes `issue: Issue`.
- `packages/brain/src/services/Brain.ts:1011,1062,1296,1479,1516`: five `as unknown as Traversal<…>` casts. **Fix:** wrap them in one typed helper.
- `as AppEnv & { HELIX_URL… }` appears 10 times in brain routes, and `params as { id: string }` 7 times. **Fix:** add the missing variables to `AppEnv` and use typed route params.
- `ctx.storage.kv.get<AutomationConfig>()` is an unchecked cast of persisted state (`automation-trigger-do.ts:360,369`). See §3.5.
- Mappers return casts instead of checked types: `as IssueStatus` in `packages/server/src/issues/server.ts:214`, and `JSON.parse(record.persona)` with no guard in `control-plane.ts:335`.

**Weaker compiler settings where they matter most:**
- `apps/web` (527 source files) does not extend the shared base tsconfig. It misses `noUncheckedIndexedAccess` and `noImplicitReturns` (`apps/web/tsconfig.options.json`).
- All 66 web test files are excluded from every tsconfig, so they are **never type-checked**. See §5.

### 3.2 Conflicting paradigms

This is the biggest source of inconsistency. Each concern has three or four competing approaches, often inside the same file.

**Error handling:**

| Layer | better-result `Result` | Effect | `throw new Error` | `null` as error |
|---|---|---|---|---|
| `apps/web/src/lib/server` | 163 | 33 | 12 | 42 |
| `executor-engine` | 0 | 14 | 0 | 0 |
| `routes/api` | 48 | 36 | 0 | 0 |
| `packages/server` | 87 | 0 | 3 | 7 |
| `packages/agent-runtime` | dominant | 9 classes | 19 in `issue-run-sub-agent.ts` alone | n/a |
| `packages/brain`, `packages/connectors` | rare | dominant | n/a | n/a |

Specific conflicts:
- **Four error-class styles in agent-runtime:**
  - better-result `TaggedError` (18)
  - Effect `Schema.TaggedError` (9)
  - `Data.Error` bases (`connectors/effect/errors.ts`, `brain/errors.ts`)
  - plain `extends Error` used for control flow (`IssueRunTurnStopped`)
- **One call chain converts three times** (`runtime-mcp-controller.ts:419-436`): Effect → `Result.tryPromise` → `throw approvalResult.error`.
- **Typed errors thrown away:** `throw new Error(result.error.message)` drops the type and its cause (`issue-run-sub-agent.ts:817-920`).
- **Overloaded error codes:**
  - An HTTP failure is tagged `database_failed` (`runtime-mcp-controller.ts:1408`).
  - `token_request_failed` covers two unrelated GitHub operations (`github-app.ts:276,323`).
  - Brain raises `HelixError` for validation, not-found *and* infrastructure failures, 41 times.
- **Four result envelopes are returned to the model:**
  - `ResultValue<T,E>`
  - `{ok:false,error:string}` (65×)
  - `{error:true,message}`
  - `ResultValue<T,string>`
- **Mixed paradigms in single modules:**
  - `automations.ts:269` calls `getDb()` outside its `Result` wrapper.
  - `document-access.ts` returns `Response | Result`.
  - `connections/$connectorId.ts` and `github/setup.ts` import both libraries.

**Validation and schema libraries.** The repo splits evenly: about 50 files use zod and about 50 use Effect Schema.
- **zod:** HTTP body parsing through `parseJsonBody` (about 30 routes), AI-SDK tool `inputSchema` (18 agent-runtime files), core, and drizzle-zod.
- **Effect Schema:** connectors (289 `Schema.` uses), brain, the document engine, executor routes, and 9 web routes.
- **Raw JSON Schema:** native connector tools, via `jsonSchema(asAiJsonSchema(...))`.
- **Hand-written checks:**
  - `typeof body.x` checks run *after* zod has already parsed the body, 17 times (e.g. `issues/$id.ts:80-104`).
  - Bodies are cast without any validation in `issues/$id/subscribe.ts:36` and `unsubscribe.ts:35`.
- **The same shapes are defined in both libraries:**
  - Skill source type exists in Effect (`core/skills/effect-schemas.ts:7`) and in zod (`db/validation/index.ts:71`).
  - `uuidSchema` is defined 3 times.
  - `agent-tools/update-issue-status.ts:21` hard-codes the status enum instead of using `issueStatusSchema`.

The recommended single convention for each layer is in §4.

### 3.3 API / server layer

**Security (details in the private advisory).** Themes to fix:
1. **Role and permission checks are opt-in per route.**
   - The member role grants no `agent`, `issue` or `permission` actions (`lib/auth/instance.ts:161-172`).
   - Only 4 handlers check `agentManage`/`issueManage`.
   - **46 mutating route files never call a permission check.**
   - New agents are created with `DEFAULT_AGENT_PERMISSIONS`, which is `full_access: true`.
2. **Foreign IDs in write bodies are not checked against the workspace.** This affects `assignee_id`, `parent_issue_id`, `project_id` and subscriber IDs.
3. **Serving user-uploaded bytes is inconsistent.** `brain/files/$id/content.ts:124-138` does it correctly: allowlist, `attachment`, `nosniff`. Other byte-serving routes do not. No CSP header is set anywhere.
4. **The PostHog `/ingest` proxy forwards request headers almost unfiltered** (`lib/server/posthog-proxy.ts:46`).
5. **An internal endpoint is authenticated by reusing `BETTER_AUTH_SECRET` with a non-constant-time comparison** (`routes/api/internal/capability-sync.ts:13-17`; sender `runtime-mcp-controller.ts:1394`).
6. **Other items:**
   - There is no rate limiting anywhere. Expensive endpoints include upload (100 MB buffered before the size check), LLM runs, automation triggers and brain ingestion.
   - A Discord bot token falls back to `''` (`runtime-mcp-controller.ts:534`).
   - `wrangler.jsonc:150-170` defaults secrets to `""`, which gets past `??` fallbacks.
   - *(Suspected)* `lib/redirect.ts` accepts `/\host`.
   - `localhost:3000/3001` is always a trusted origin (`lib/auth/instance.ts:397-404`).
   - Handlers load the resource before checking the session, so unauthenticated callers get 404 instead of 401, which reveals whether a resource exists.

**Three API stacks and three ways of doing auth:**
- **(a)** TanStack file routes that use `requireSession`/`requireWorkspaceAccess`. These return `T | Response`, and callers check `instanceof Response` 83 times. `requireAppRequestContext` is called 214 times.
- **(b)** TanStack routes that run Effect programs through `runExecutorRouteEffect`: 16 files.
- **(c)** An Effect `HttpApi` mounted at `routes/api/$.ts`, with its own `WorkspaceAccess` service (250 lines). It re-implements `control-plane.ts:40-150` and `workspace-permissions.ts`.
- Workspace membership is queried inline in 13 more places.
- About 40 call sites pass the raw `Request` instead of `appContext`. That builds a fresh Better Auth instance and a fresh pg client per call, bypassing the request-scoped DB and the session cache.

**Six error response shapes:**
1. `{ error: string }` (dominant)
2. `{ ok:false, error:{code,message} }`, and its success counterpart `{ok:true,value}`, used 61 times in automations
3. `{ ok:false, error:string }`
4. `{ error, requestId, traceId? }`
5. plain-text `new Response('Unauthorized')` (`server.ts:154,193,209,233`)
6. an empty-body 400 (`garden-api.server.ts:19`)

Success bodies vary too: a bare array, `{issues,total}`, or `{ok:true,requests}`.

**Data access in route handlers:**
- 53 of 91 route files run drizzle directly, about 130 query-builder calls in total.
- `issues/$id.ts` PUT (lines 69-300) does the update, subscriber add, inbox upsert, email, archive, run cancels and run starts **without a transaction**.
- `packages/server` already has `readIssue`/`listIssues`, but the routes don't use them.
- Comments are inserted in 4 places that bypass `postIssueComment`, so mentions, inbox entries and wake-ups are skipped (`work-products.ts:631`, `agent-runtime/.../post-comment.ts:37`, `mark-blocked.ts:56`).
- There are 18 `.update(schema.issue)` sites across 4 packages.
- `upload-file.ts:117-149` writes to R2 and then inserts the row, so a failed insert leaves an orphaned object.

**Unbounded queries and pagination:**
- Two places load the whole issue list:
  - `issues/child-progress.ts:23-26` loads every workspace issue to count children in JS.
  - `inbox-compute.ts:437-441` does the same.
- `issues.ts:84-92` has an optional `limit`, so requests are unbounded by default.
- Pagination is offset-based in some places, limit-only in others, and absent in comments, timeline, agents, threads and inbox.

**Oversized modules:**

| Module | Lines |
|---|---|
| `packages/server/src/issues/server.ts` | 1,256 |
| `work-products.ts` | 967 |
| `inbox-compute.ts` | 951 |
| `issues/run-service.ts` | 879 |
| `automations.ts` | 750 |
| `routes/api/connections/$connectorId.ts` | 722 (one POST handler, nested 34 spaces deep) |
| `auth/instance.ts` | 672 (Better Auth config mixed with OAuth connector callback logic) |

**Recommendations:**
1. Build one `apiRoute({ auth, permission, body, handler })` wrapper on TanStack `createMiddleware`. It resolves session, workspace and the *declared* permission from `appContext`. It validates the body. It maps `TaggedError.code` to an HTTP status in one place (validation → 4xx; `db_error`/`runtime_error` → 500 with a generic message). It emits one error envelope, `{ error: { code, message }, requestId }`. Make the permission declaration required for mutations, and add a test that fails when it is missing.
2. Retire the `T | Response` unions, the duplicate `WorkspaceAccess`, the copy in `document-access.ts`, and the automation-only envelope.
3. Move data access into `packages/server` repositories, keep one `toIssue` mapper, and route all comment creation through `postIssueComment`.
4. Add a shared `assertSameWorkspace(db, workspaceId, refs)` and call it before storing any foreign ID.
5. Add a shared `serveStoredObject()` (allowlist, `nosniff`, `CSP: sandbox`), use it in every byte-serving route, and add a global security-headers middleware.
6. Add a cursor-pagination helper with a default limit enforced by the server.

### 3.4 Data layer

**Schema conventions.** 41 tables. Names are consistently singular snake_case, which is good. Almost everything else varies:

| Convention | Current state | Target |
|---|---|---|
| Timestamps | Only 16 of 85 columns are `timestamptz`, all in `issues.ts`/`automations.ts`. Some tables mix both types (`issue_run`, `automation_run`, `issue`). | `timestamp(…, { withTimezone: true, mode: 'date' })` everywhere |
| `created_at` / `updated_at` | Nullable on 19 tables; missing on 7; `agent` has no `updated_at`; 0 uses of `$onUpdate`; 40 manual `updatedAt:` assignments. Mappers invent `new Date()` when the value is null (`control-plane.ts:312-317`, `server.ts:245`). | `NOT NULL DEFAULT now()`, with `$onUpdate` on `updated_at`, supplied by shared column helpers |
| ON DELETE | 59 of 92 FKs are `no action`. Workspace children: 6 cascade, 19 no action. | cascade from workspace to its children; set null (or a deliberate restrict) for authorship columns |
| PK defaults | 14 tables default in the DB; 25 rely on the app to supply the id | a DB default on every uuid PK |
| Enums | 5 strategies, no `pgEnum`. Inline SQL lists, shared `*Values` constants, `text({enum})`, `$type<>`, and some with no CHECK at all (`skill.source_type`, `inbox_item.type`, `issue_run_event.event_type`, `invocation_log.status`). `sqlValueList` is copied twice. | one `schema/values.ts` holding `as const` lists, plus a `checkIn(col, values)` helper |
| Vocabulary | `'user'` vs `'member'` for the same actor role, with 4 manual translations. `canceled` vs `cancelled`. `succeeded` vs `completed`. | `member \| agent`, `cancelled`, one terminal status set |
| JSONB | 2 of 31 columns are typed, and both are effectively `unknown`. `agent.runtime_config` is never read. | `$type<T>()` with `T` taken from a core schema that also validates on write |
| Tenant column | `workspace_id` on 23 tables, `organization_id` on 2. 16 tables have no tenant column. `workspace_id` is not the leading index column on hot run tables. | `workspace_id` on every tenant-owned table, leading the index |
| Polymorphic refs | 7 type/id pairs with no FK. `inbox_item.recipient_id` has an FK to `user`, but its CHECK allows `'agent'`. `project_id` references a table that doesn't exist. | split FK columns plus a CHECK, or a documented exemption; drop `project_id` or add the table |
| Soft delete | 4 styles: `archived_at`, `archived` boolean, `status='archived'`, and hard delete | `archived_at timestamptz` |
| Indexes | Many FK lead columns are unindexed, including **`issue_comment.issue_id`**, which every comment read filters on | an index on every FK |

**Migrations (see D4):**
- 16 of 48 migrations mix data changes (UPDATE/INSERT/DELETE) into schema changes.
- Some are destructive with no guard: `0031` deletes from 5 tables, `0044` drops `document_edit`, `0039` rewrites statuses.
- **Rules:**
  - Never edit a migration that has been applied.
  - Put data backfills in separate, idempotent `*_data_*` migrations.
  - Require reviewer sign-off on DROP or DELETE.
  - Add a CI job that runs `drizzle-kit check`, a fresh `migrate` against a test database, and a `generate` that must produce no diff.
  - Add a journal lint that checks idx is unique, `when` is monotonic, and prefixes are unique.

**Types:**
- **`Agent`** (`core/src/types/agent.ts`) has about 10 fields with no column behind them. `toAgent` fills them with constants (`runtime_mode:'cloud'`, `max_concurrent_tasks:1`, …), the UI displays them, and validation accepts input for fields that are never stored.
- **`Issue`** wire names differ from the DB (`parent_issue_id`/`parentId`, `creator_id`/`createdBy`). There are two `toIssue` mappers, and one of them has no return type.
- **Automation unions** are declared 3 times, and the copies disagree (`ConcurrencyPolicy`, `RunSource`). The web `AutomationTrigger` still has `next_run_at`/`last_fired_at`, which were dropped in migration 0030.
- **`InboxItemType`** has 16 values in core and 8 in db.
- **Casing:** `Invitation` is camelCase while every other DTO is snake_case.
- **Date helpers:** there are 7 copies of a date-to-ISO helper.
- **Unused types:** **82 of 128 exported core types are never used** outside core.

**Package boundaries:**
- `@garden/core` ("shared types") depends on `@garden/db` and does DB I/O (`core/src/issues/source-binding.ts`). The dependency should go the other way.
- `agent-runtime` has no `exports` map, so web imports `@garden/agent-runtime/src/...` directly. Its fixtures import `../../../../packages/db/src/...`.
- Server-side agent-runtime imports from the client state package `@garden/app-state`.
- `@neondatabase/serverless` is declared in 3 packages, imported 0 times, and banned by the repo's own lint rule.

### 3.5 Agent runtime and connectors

Type hygiene here is strong: 0 `any`, and every `JSON.parse` is wrapped. The problems are duplication and lifecycle.

**Copy-paste forks:**
- `issue-run-sub-agent.ts` (2,434 lines) and `automation-run-sub-agent.ts` (2,139) share **1,286 identical lines** once "issue" and "automation" are normalized: 60% and 53% of the files respectively.
- 43 of the 49 methods have the same name in both files. 13 are identical and about 10 more are at least 75% similar.
- Blocks of 70+ identical lines include issue `854-924` = automation `858-928`.
- The sandbox ID helpers appear a third time in `agent-do.ts:2416-2530`.
- `dbError` is defined in 5 files, `errorMessage` in 4, `getModel()` in 4 classes, and `TERMINAL_SUBMISSION_STATUSES` in 3.
- **Fix:** a `RunSubAgentBase<TRunContext>` (or a composed `RunLifecycle` service) that owns workflow submission, cancellation, sandbox, MCP preparation, usage and timeouts. Subclasses supply only the context, tools and finish policy.

**Oversized files with mixed concerns:**
- `agent-do.ts` (2,552) holds two DO classes, about 450 lines of debug endpoints and 23 raw Drizzle calls.
- `chat-sub-agent-tools.ts` (2,189) mixes tool schemas, DB domain logic and RPC.
- `runtime-mcp-controller.ts` (1,657) contains `ensureConnectorToolNeedsApproval` at about 285 lines, and copy-pasted Discord and GitHub blocks.
- `document-tools.ts` has a `generateDocx` function of about 360 lines.
- In `Brain.ts`, `makeBrain` is one closure of about 1,150 lines.

**Connector consistency:**

| | GitHub | Discord |
|---|---|---|
| Tool naming | unprefixed (`list_issues`) | prefixed (`discord_list_servers`) |
| Output schemas | 0 / 37 | 11 / 13 |
| Response decoding | none | schema-decoded |
| HTTP error mapping | all errors → `ConnectorHttpError` | 401/403/404/429 typed |
| Auth | mints a new App JWT and installation token **on every request** | env token with `''` fallback |
| Install flow style | better-result, raw `fetch`, `as` casts | Effect `HttpClient` + Schema |
| Pagination input | unbounded non-integer numbers | unbounded |
| Timeouts / retries | none (REST) | none; `retryAfterMs` is mapped but never read |

The Discord connector also references an `icon.svg` that does not exist and has no README.

**Fix:** one `makeProviderRestClient({ baseUrl, auth, statusMapper })` with a timeout, status mapping, schema decoding and a 429/5xx retry that honors `retryAfterMs`. Cache GitHub installation tokens until shortly before `expires_at`. Require output schemas and integer-bounded pagination for every tool.

**Durable Object state:**
- **Cron reschedule bug (D6):**
  - `fireNow` skips the concurrency policy and overwrites `inFlightRunId`.
  - *(Suspected)* The check-then-set spans several awaits, so concurrent fires race. Reserve `inFlightRunId` synchronously, before the first await.
- **Unversioned storage:**
  - KV reads are unchecked casts.
  - Four ad-hoc `CREATE TABLE IF NOT EXISTS` sites run on every call, with no migration ledger.
  - **Fix:** a per-DO `migrations: [{version, sql}]` runner, plus schema-decoded KV values.
- **Authorization caches never evict:** `authorized{Thread,Issue,AutomationRun}Ids` in `AgentDO` (`agent-do.ts:420-422`) are unbounded `Set`s with no invalidation. `apps/web/src/server.ts:64` has a similar 60-second unbounded `Map`.
- **Effect setup is inconsistent:** some code builds a new Effect `Layer` on every tool call, while documents keep a long-lived `ManagedRuntime`. Standardize on a `ManagedRuntime` per DO.

**Inline prompts:**
- `instructions/base.ts` is 16.6 KB of inline prompt text, with one line of 1,287 characters.
- `bundled-skill-files.ts` is a 198-line hand-maintained list of R2 paths.
- **Fix:** move prompts to `.md?raw` assets (one skill already does this) and generate the inventory at build time.

### 3.6 Frontend architecture

**God components:**

| File | Lines | Notes |
|---|---|---|
| `features/issues/components/issue-detail.tsx` | 2,548 | `IssueDetail` alone is about 1,710 lines. It has 16 `useState`s and 49 imports, and contains fixtures, an inline optimistic mutation and localStorage logic. |
| `features/connections/components/connections-page.tsx` | 1,623 | 11 components, a private debounce, an OAuth `postMessage` listener, 4 inline query keys |
| `features/skills/components/skills-page.tsx` | 1,512 | 16 components, 5 inline `useMutation`s, a default export |
| `features/automations/automations-page.tsx` | 1,210 | a 530-line dialog built from raw `<input>`s |
| `features/settings/components/environment-debug-drawer.tsx` | 1,186 | 18 components, 46 arbitrary font sizes |
| `features/chat/components/chat-composer.tsx` | 1,096 | `Composer` is about 875 lines |
| `features/brain/components/files-page.tsx` | 1,066 | 8 inline mutations, a custom tablist |

**Data fetching and state:**
- **Query keys:**
  - Keys come from three kinds of places: `lib/<domain>/queries.ts`, `features/<domain>/queries.ts`, and `dashboard.queries.ts`.
  - There are 20 inline `queryKey: [...]` literals.
  - Some keys are duplicated independently: `['chat-threads', …]` in `chat/use-agent-chat-sessions.ts:43` and `issue-detail.tsx:143`, and `['chat-thread-documents', id]` in two files.
  - Skills, connections, chat documents and the executor registry have no key factory at all.
- **Four ways to call the backend:**
  1. the `api` transport (canonical)
  2. hand-copied transport logic, repeated three times in `features/brain/api.ts`
  3. raw `fetch` (`document-artifact.tsx:225`, `chat-document-panel.tsx:377`, `use-debug-stream.ts:206`)
  4. imperative debounce, fetch and abort in `use-issue-search.ts`, which swallows errors
- **Stores:**
  - zustand stores are split between `packages/app-state` and `apps/web/features`, built in two styles (`create` and `createStore` with an `Object.assign` shim).
  - Server data is mirrored into zustand (`useAuthStore.user`, `useWorkspaceStore.workspace`).
  - The `nuqs` adapter is mounted, but `useQueryState` is used 0 times.
- **`useEffect` misuse:** there are 57 effects in features. Some:
  - reset state that a `key` should reset (`chat-composer.tsx:413,417`, `chat-document-panel.tsx:513`)
  - re-sync form fields from server data, which overwrites in-progress edits when a refetch arrives (`automation-detail-page.tsx:391`, `workspace-tab.tsx:52`, `account-tab.tsx:84`)
  - fetch inside an effect (`document-artifact.tsx:215-309`)

  A comment in `tasks.$issueId.tsx:7` claims a "no-useEffect rule" that nothing enforces.
- **Optimistic updates** are written three different ways. `errorMessage()` exists in `lib/api/errors.ts:9`, but there are 30 inline `instanceof Error ? e.message` copies plus one re-implementation.

**Folder structure:**
- **Layout:**
  - Some features have no `components/` folder: automations, artifacts, editor, roadmap, search, modals.
  - Some put everything in `components/`.
  - Others mix both.
- **Hooks:**
  - `issues/hooks/`
  - top-level `chat/use-*.ts`
  - `settings/components/use-*.ts`
  - `lib/workspace/hooks.ts`
- **Shared UI** is spread over 6 locations: `components/`, `components/shell`, `features/common`, `features/layout`, and `packages/ui/components/{common,shell}`.
- **Two "platform" folders:** `src/platform/` and `features/platform/`.
- **Barrels:** some features have `index.ts`, some only `components/index.ts`, some neither.
- **Imports and exports:**
  - `#/*` is declared but used 0 times, while `@/` is used 268 times.
  - Default exports appear only in `agents-page.tsx` and `skills-page.tsx`.
- **Server code inside the UI tree:** `features/dashboard/dashboard.server.ts`.

**Duplicated utilities:**
- **Relative time:** 6 divergent implementations (`dashboard-page.tsx:48`, `inbox-list-item.tsx:7`, `session-explorer.tsx:23`, `automations-page.tsx:183`, `brain/format.ts:49`, `account-tab.tsx:33`). Meanwhile `@garden/core/utils` `timeAgo` is used by only 3 files.
- **Date formatting:** `formatDate` is copied 3 times.
- **Token counts:** 3 formatters.
- **Debounce:** 3 hand-rolled versions.
- **PDF rendering:** 3 approaches, and `workerSrc` is configured twice.
- **Markdown:** 3 renderers.
- **Syntax highlighting:** 2 highlighters (shiki and lowlight).
- **Status colours:** `STATUS_COLOR` is copied between `agents-page.tsx:26` and `agent-detail.tsx:26`. `dashboard.server.ts:83-97` redefines the status colours that already exist in `@garden/core/issues/config`.

**Vendored ai-elements:**
- About 25 of 49 files (about 8k lines) are never imported, including `prompt-input.tsx` at 1,458 lines.
- Six npm dependencies are used only by those dead files: `react-jsx-parser`, `@rive-app/react-webgl2`, `media-chrome`, `tokenlens`, `ansi-to-react`, `nanoid`.
- The live files follow a different house style: arrow components and raw palette colours.
- The dead code contains `dangerouslySetInnerHTML` with unescaped input (`schema-display.tsx:99-108`) and an iframe sandbox weakened by `allow-scripts` together with `allow-same-origin` (`web-preview.tsx:202`).
- **Fix:** delete the unused files and dependencies. Move the files that are used into `packages/ui/components/ai`, bring them into the house style, and own them from then on.

**Accessibility:**
- 10 of 38 icon buttons have no accessible name (e.g. `automation-detail-page.tsx:354`, `comment-input.tsx:90`, `issue-detail.tsx:1098,1134`).
- `<span onClick>` is used as a link in `readonly-content.tsx:97,185`.
- Two hand-rolled modal overlays have no focus trap (`editor/extensions/image-view.tsx:30`, `chat-document-panel.tsx:215`).
- Iframes without a sandbox render artifact URLs, including SVG (`document-artifact.tsx:104`, `chat-document-panel.tsx:335`).
- A localStorage key is duplicated across files and accessed without try/catch, bypassing the `@garden/app-state` storage adapter (`issue-detail.tsx:869,1460`, `create-issue.tsx:181,263`).

### 3.7 Design system

**What works:** `tokens.json` feeds `build-tokens.mjs`, which writes `tokens.css`. The generated file is in sync with the source (this was verified by regenerating it), and CI enforces that with `git diff`. Keep this pipeline.

**Three token vocabularies are live at once:**

| Role | shadcn compat | new semantic | legacy "parchment" |
|---|---|---|---|
| Secondary text | `text-muted-foreground` **813** (#5a5a5a) | `text-text-secondary` 26 (**#757575**) | `--gravel` 16 |
| Border | `border-border` 89 (+939 bare `border`) | `border-border-default` 26 | `hairline*` 72 |

**Problems in the token set itself:**
- The new semantic set contains near-duplicates with **different values**. `--text-default` is #1e1e1e while `--text-neutral-default` is #303030, and `--border-default` is #d9d9d9 while `--border-neutral-default` is #303030. So the "same" role renders different greys depending on which name a contributor picked.
- `LEGACY_COMPAT` in `build-tokens.mjs:216-288` is labelled "transition only". It is still used in 24 files: `automations-page.tsx` 61, `dashboard-page.tsx` 48, `roadmap-page.tsx` 40, `harnessy-page.tsx` 21.
- Primitive ramps are named `gray`/`red`/`blue`/…, which **partly overrides Tailwind's palettes**. `bg-gray-100` uses the token, but `bg-gray-50` silently falls back to Tailwind's default.
- **Hand-copied palettes:**
  - `architecture.css:16-42`, `harnessy.css:15-44` and `roadmap.css:19-45` redefine about 23 variables each as hex. Their comments claim to mirror `tokens.css`, which is no longer true.
  - Three email templates share a fourth palette (`lib/server/email/*-email.tsx:11-22`).
  - `appearance-tab.tsx:12-26` hard-codes hex copies of tokens.

**Raw values instead of tokens:**

| Metric | packages/ui | apps/web |
|---|---|---|
| Tailwind palette classes (`bg-red-500`…) | 2 | 224 (about half in dead ai-elements) |
| Hex literals in TSX | 4 | 57 |
| Arbitrary values (`text-[13px]`, `[color:var(--…)]`) | ~120 | ~660 |
| `style={{}}` | 3 | 56 |

**Scales:**
- **Font sizes:** 34 distinct sizes are used against a 10-step token scale. `text-[11px]` appears 94 times and `text-[10px]` 66 times, along with fractional sizes such as 9.5, 10.5, 11.5, 12.5, 13.5, 14.5 and 15.5px. **174 uses are below the 12px token minimum.**
- **Composite typography:** the 13 generated typography utilities (`heading-large`, `body-main`, …) and `font-heading` (Cabinet Grotesk) have **0 uses**.
- **Radius:** 26 variants against 8 tokens. `badge.tsx:8` uses the off-scale `rounded-4xl`. `button.tsx` contains `rounded-[min(var(--radius-md),10px)]`, which has no effect.
- **Shadows:** 23 variants. Token shadows `shadow-1…7` are used 4 times in total.
- **Recipes:** `dashboard-page.tsx` inlines the `.vellum` recipe 13 times, although the class already exists.

**Component duplication and bypassed primitives:**
- **Icons:** three libraries. lucide is in about 128 files, `@phosphor-icons` in 14 (the redesign shell), and `@tabler/icons-react` in 1.
- **lucide-react versions:** `apps/web` uses `^0.545.0` while `packages/ui` uses the catalog's `^1.0.1`, so both majors ship in one bundle.
- **Spinners:** 49 manual `animate-spin` uses against 3 imports of `Spinner`.
- **Raw elements:** 95–112 raw `<button>`s, of which **about 100 have no focus style**.
- **Tooltips:** 71 native `title=` attributes.
- **Headers:** 29 raw `<header>`s with 5 different paddings, while `PageHeader` is used twice.
- **Skeletons:** 3 approaches.
- **Forms:** TanStack Form is used once; every other form uses `useState`.
- **Code blocks:** two implementations.
- **Logos:** `GardenLogo` (a blue wave) and `BrandIcon` (a leaf) are both in use.

**Dead and misplaced code in `packages/ui`:**
- `components/ui/onboarding.tsx` has 879 lines and **0 importers**.
- `components/ui/sidebar.tsx` has 713 lines. `SidebarProvider` is mounted nowhere, so its only consumer branch never renders.
- `direction.tsx` is unused.
- Dead CSS in `base.css`: `.animate-chat-impulse`, `.vellum`, `.vellum-light`, `.prose-agent`.
- Unused dependencies: `vaul`, `input-otp`, `react-resizable-panels`, `recharts`.
- `components/shell/*` and `components/common/*` are product-specific but live in the generic UI package.
- Inside the package there are three import conventions: relative, `@garden/ui/…`, and `@/`. `packages/ui/components.json` targets `@/`, which inside apps/web resolves to `apps/web/src`.
- `"use client"` appears in 13 of 47 files, although the app has no React Server Components.

**Docs:**
- `docs/design.md` is marked "Locked" but describes a different system.
  - Fonts: Geist and DM Sans, where the code uses Inter and Geist Mono.
  - Theme: "never use dark", while full dark mode ships.
  - Radius: tokens that don't exist.
- It also contradicts itself on pills (lines 9, 68 and 200).

**Accessibility:** `--text-tertiary` (#b3b3b3) on white has a contrast ratio of about 2.1:1.

### 3.8 Config, logging, observability

**Environment and config:**
- **`@garden/env` is unused at runtime.** It has 3 importers (drizzle config, `db/src/client.ts`, and the Better Auth CLI).
- **The Worker env is never validated.** It goes through `export let appEnv = {} as AppEnv` (`apps/web/src/lib/server/env.ts:54`), a mutable global that is rebound on every request and used in 40 files.
- **Bindings are declared in 4 places:** `wrangler.jsonc`, `alchemy.run.ts`, `AppEnv`, and `packages/env`. `AppEnv` includes `DISCORD_*`, which `@garden/env` lacks.
- **Importing `@garden/db` throws if `DATABASE_URL` is missing,** because `db/src/client.ts` evaluates the env at import time.

**Logging:**
- **There are 83 direct `console.*` calls in runtime code:**
  - 54 in agent-runtime (`runtime-mcp-controller` 16, `issue-run-sub-agent` 14, `automation-run-sub-agent` 13)
  - 27 in web
  - about 30 `createGardenLogger` calls exist alongside them
- **Those warnings never reach alerting.** `workers/tail-observer` only escalates structured records (`source:'garden'`), so warnings such as "failed to persist issue run usage" are never surfaced.
- **`@garden/observability` exports two loggers.** The `./console` logger, which does no secret redaction, is used in 11 files, including server code.
- **The service name is wrong outside staging.** All 12 logger call sites hard-code `service: 'garden-staging'`, even in production.
- **5xx response bodies are logged.** `server.ts:283-292` logs up to 1,000 characters of every 5xx body, which contradicts the redaction policy in `api-logging.ts:116-118`.
- **The log type is duplicated.** tail-observer redefines `GardenStructuredLog` locally instead of importing it.

**Background work:** `issues.ts:151` runs `void startIssueRun(...)` without `waitUntil`, so the Worker can cancel it.

**Fix:**
- Parse the env once per request with the `@garden/env` schema (`parseWorkerEnv(bindings)`) and attach it to `appContext`. Then delete `appEnv`.
- Use only the structured logger on the server, and ban `console` with lint.
- Derive the service name from the deploy target.
- Send all background work through `appContext.waitUntil`.

### 3.9 Tooling, CI, dependencies

**Lint:**
- `.oxlintrc.json` enables only the `correctness` category, with the `typescript`, `unicorn` and `oxc` plugins.
- Nothing bans `any`, non-null assertions or `console`. No React hooks, a11y, import-cycle or promise rules run.
- There are 24 suppression comments in two syntaxes, `eslint-disable` and `oxlint-disable`. **Most target rules that aren't enabled, so they do nothing.** Examples: `document-artifact.tsx:308`, `app-state/src/platform/core-provider.tsx:56`, and the ai-elements files.
- `ignorePatterns` misses `routeTree.gen.ts`, `worker-configuration.d.ts` and `third_party/**`.

**CI (`.github/workflows/ci.yml`):**
- **Not checked:**
  - Formatting (`pnpm format`) is not run.
  - Root-level files (`scripts/`, `alchemy.run.ts`, `deploy-targets.mjs`) are never linted or formatted.
  - `worker:types:check` is not run. Worse, `typecheck` *regenerates* the committed `worker-configuration.d.ts`, which overwrites drift instead of reporting it.
  - `verify:deploy-config` does not run.
  - gitleaks does not run, although `.gitleaks.toml` exists.
- **Wasted work:**
  - The heaviest typecheck runs twice: once in CI, and again inside the web `build` script.
  - Every PR commit runs CI twice (triggers on `push: **` and `pull_request`).
- **Already good:** actions are pinned by SHA and permissions are read-only.

**Dependencies:**
- **Effect version conflict:**
  - The catalog says `effect: 4.0.0-beta.102`, but `pnpm.overrides` forces `4.0.0-rc.111`, and the lockfile only contains rc.111.
  - `packages/brain` pins `@effect/platform-node: 4.0.0-beta.102` literally.
  - `third_party/executor/PATCHES.md` documents the old version.
  - **Fix:** set the catalog to the version that is actually installed, and remove the redundant overrides.
- **Two majors installed at once:**
  - lucide-react 0.545 and 1.8
  - react-day-picker 9 and 10 (the web copy is imported 0 times)
  - zod 3.25, 4.3 and 4.4
  - vite 8.0.16 and 8.2.1
- **Unpinned:**
  - TanStack Router and Start packages are pinned to **`latest`** (`apps/web/package.json:79-86,166`).
  - `@tanstack/start-server-core` is overridden to 1.167.30 while `react-start` resolves to 1.167.42.
  - Scripts call `shadcn@latest` and `@better-auth/cli@latest`.
- **Catalog drift:** `apps/web` declares 15+ catalog-listed dependencies as literals instead of `catalog:`.
- **Phantom dependencies** work only because of `nodeLinker: hoisted`:
  - `connectors` imports `better-result` without declaring it.
  - `server` imports `zod` without declaring it.
  - Root `dependencies: better-result` hides both.
- **Misplaced or unused:**
  - `rehype-sanitize` is a devDependency of `packages/ui` but is imported at runtime (`markdown/Markdown.tsx:7`).
  - `@neondatabase/serverless` is declared but unused (×3).
  - `@garden/connectors` and the MCP SDK are root devDependencies that nothing imports.
- **Undocumented:** the 7 patches (one is 911 lines) and the 35 overrides. CODEOWNERS doesn't cover `patches/`, workflows or the deploy scripts.
- **No automation:** there is no Dependabot or Renovate.

**TypeScript:** see §3.1 and §5. `apps/web` doesn't extend the base config. Packages reference the base in two different ways, `../tsconfig/base.json` and `@garden/tsconfig/…`. The base config enables emit options that nothing uses.

**turbo.json:**
- `globalEnv` lists `NEXT_PUBLIC_*`, `FRONTEND_*` and other variables that nothing reads.
- The `POSTHOG_*`, `VITE_*` and `ENABLE_DEVTOOLS` variables that `vite.config.ts` *does* read are not declared, so build cache keys ignore them.

**Windows contributors:**
- The deploy scripts use `pkill`, `rm -rf`, the POSIX `VAR=x cmd` syntax, `python3` and `bash`.
- **Fix:** add `shellEmulator: true` to `pnpm-workspace.yaml` and write a `scripts/clean.mjs`.

**package.json metadata:**
- `brain` has no `license`.
- `db` and `env` have no `version`.
- `agent-runtime` uses `main` without `exports`.
- `packageManager` is repeated in sub-packages.

### 3.10 Tests

| Package | src files | test files | Notes |
|---|---|---|---|
| apps/web | 527 | 66 | **Tests are not type-checked.** Only 14 of 91 API routes are imported by any test. issues/*, inbox/*, chat/threads/*, documents/*, automations/*, upload, attachments and work-products have none. |
| agent-runtime | 62 | 25 | Only about 35% of lines are reachable from tests. `agent-do.ts`, both run sub-agents, `chat-sub-agent-tools.ts` and `automation-trigger-do.ts` have **0 tests**. |
| packages/server | 4 | 1 | A 41-line test covering about 2,500 lines of services |
| packages/ui | 60 | 1 | **The one test never runs**, because there is no `test` script. |
| env, tail-observer | n/a | 0 | No test script |

- There are **no authorization tests** (member vs admin vs non-member), which is why the gaps in D1 and D2 went unnoticed.
- `brain` and `core` set `passWithNoTests: true`, and a global 120-second timeout hides hangs.
- `-executor-inline-routes.test.ts` checks source-code strings instead of behaviour.

### 3.11 Repo hygiene and docs

**Committed agent skill content:**
- 454 files of agent skill content are committed under `.agents/skills`, including a vendored copy of the `better-result` source.
- There are also 16 symlinks in `.claude/skills`; on Windows checkouts without `core.symlinks` they become text stubs.
- **Fix:** install these from `skills-lock.json` on demand and gitignore them. If they must stay, mark them `linguist-vendored` and exclude them from lint and format.

**Stray files:**
- `apps/web/posthog-setup-report.md` is wizard output. It has a PostHog project ID, an unfinished checklist, and references a file that doesn't exist.
- `apps/web/.cta.json` is scaffold output.
- `apps/web/.prettierignore` exists, although the repo does not use Prettier.
- Personal entries in `.gitignore`: `db.txt`, `/task_plan.md`, `/findings.md`, `.pi/`, `.dogfood/`.

**Generated files:** `routeTree.gen.ts` and `worker-configuration.d.ts` are not marked `linguist-generated` in `.gitattributes`.

**Stale docs:**
- The README repo map omits `packages/brain` and `packages/tsconfig`.
- 21 doc references point at paths that no longer exist, for example `components/shell/workspace-dock.tsx` and `packages/workshop-backend/...`.
- `docs/design.md` is out of date (§3.7).
- `PATCHES.md` is out of date (§3.9).
- `apps/web/scripts/dev.mjs:22-24` refers to a miniflare patch that doesn't exist.

**Naming:**
- Files are kebab-case everywhere except `packages/brain/src/services` (`Brain.ts`, `HelixClient.ts`, …).
- `packages/db/src/schema/auth.ts` uses double quotes while every other file uses single quotes.

**Deploy naming:** `GARDEN_DEPLOY_TARGET=staging … --stage production`, and `deploy-targets.mjs` maps "staging" to the stack `garden-production`.

---

## 4. Canonical conventions

The core problem is several patterns per concern. Below is a proposed single answer for each concern. Two choices need maintainer agreement and are marked ⚖️. Everything else follows the pattern most of the code already uses.

| Concern | Canonical choice | Retire |
|---|---|---|
| **Errors in app and service code** (`apps/web/lib/server`, `packages/server`, DO orchestration) | better-result `Result` + `TaggedError` with a typed `code` | `throw new Error(msg)`, `null` as an error, `{ok:false,error:string}` |
| **Errors inside Effect subsystems** (brain, connectors, executor-engine, document engine) | Effect + `Schema.TaggedError` with **one tag per failure kind** (`NotFound`, `Validation`, `Upstream`) | `Data.Error` bases, overloaded `HelixError`/`database_failed` |
| **Effect ↔ Result boundary** | One adapter, `runEffectResult(effect, runtime)` built on `runPromiseExit` | ad-hoc `Result.tryPromise(Effect.runPromise(...))` plus rethrows |
| **Throwing** | Only in framework hooks that require it, and rethrow the *typed* error | everywhere else |
| **HTTP route shape** | `apiRoute({ auth, permission, body, handler })` middleware | `T \| Response` unions, inline membership queries, per-route `runError()` mappers |
| **HTTP error envelope** | `{ error: { code, message }, requestId }`, with status mapped from `code` in one place | the other 5 shapes |
| **Request validation** ⚖️ | zod at the HTTP boundary and for AI-SDK tool inputs; Effect Schema only inside Effect subsystems. Enumerations always come from shared `as const` arrays. *(Alternative: converge fully on Effect Schema through Standard Schema. More consistent, more migration work.)* | hand-written `typeof` checks after parsing, unvalidated `as` casts, duplicated enums |
| **Agent tools** | One `defineAgentTool({ input, output, handler })` returning one result envelope (`toolOkResult`/`toolErrorResult`) | 4 result envelopes, raw `jsonSchema()` wiring |
| **DB access** | Request-scoped `Db` passed into `packages/server` repositories; transactions for multi-write flows | `getDb()`, `createDb`, `getPooledDbWith`, drizzle in route handlers |
| **DB columns** | Shared helpers: `id()`, `createdAt()`, `updatedAt()`, `workspaceId()` (cascade + index), `archivedAt()`, `checkIn(col, VALUES)` | per-table hand-rolled definitions |
| **Wire DTOs** | `@garden/core` owns snake_case DTOs. One typed mapper per entity (`satisfies Issue`) in `packages/server`. | invented fields, duplicate mappers, camelCase outliers |
| **Package graph** | `core` is a leaf (types, schemas, pure logic) with no DB I/O. Every package has an `exports` map. No `/src/` deep imports. | `core → db`, `agent-runtime → app-state` |
| **Config** | `@garden/env` `parseWorkerEnv(bindings)` once per request, attached to `appContext` | mutable `appEnv` global, `as AppEnv & {…}` casts |
| **Logging** | `createGardenLogger` (structured, redacted) on the server; the service name comes from the deploy target | `console.*`, `./console` logger on the server |
| **Client data** | Per domain: a key factory + `queryOptions` + `use<X>Mutations()` (with `onMutate`/`onError`/`onSettled`), all over `ApiTransport` | inline keys, raw `fetch`, server data mirrored in zustand |
| **Client state** | Server data lives in React Query. Cross-feature UI state lives in `create()` zustand stores in `packages/app-state`. Feature-local state stays local. URL state goes through route `validateSearch`. | `createStore` shims, `nuqs` (or adopt it) |
| **Feature layout** | `features/<x>/{index.ts, api.ts, hooks/, components/, utils/}`, one component per file, named exports, `@/` alias only | the current mix, `#/` alias, default exports |
| **Design tokens** | shadcn semantic names are the component contract; Figma tokens map *into* them in `tokens.json`; primitives are namespaced (`--prim-gray-100`) | `LEGACY_COMPAT`, near-duplicate semantic names, raw palette classes, hex values, `[color:var()]` |
| **Scales** | Only token steps compile: reset Tailwind defaults in `@theme`, and add a `text-2xs` (11px) step if it is truly needed | arbitrary `text-[Npx]`, `rounded-[…]`, `shadow-[…]` |
| **Icons** ⚖️ | One library: lucide by usage (about 128 files) unless the redesign commits to phosphor | the other two |
| **Primitives** | `Dialog`, `Spinner`, `Tooltip`, `Tabs`, `PageHeader` and `Button` from `@garden/ui`; one Markdown renderer, one highlighter (shiki), one PDF viewer | hand-rolled overlays, `animate-spin`, `title=`, custom tablists |
| **Timestamps** | `timestamptz`, ISO strings on the wire, one `toIso()` / `formatRelative()` in `@garden/core/utils` | 7 ISO helpers, 6 relative-time formatters |
| **Migrations** | Never edit an applied migration; data changes go in separate idempotent migrations; CI verifies them | hand-edited journal and snapshots |
| **File naming** | kebab-case | PascalCase files in `packages/brain/src/services` |

These conventions should go into `CONTRIBUTING.md`, with a short "why" for each, so contributors can find them.

---

## 5. Enforcement

### 5.1 `.oxlintrc.json` (proposed)

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["typescript", "unicorn", "oxc", "react", "react-hooks", "jsx-a11y", "import", "promise", "vitest"],
  "categories": { "correctness": "error", "suspicious": "warn", "perf": "warn" },
  "env": { "builtin": true, "browser": true },
  "ignorePatterns": [
    "**/node_modules/**", "**/dist/**", "**/.output/**", "**/.tanstack/**",
    "**/routeTree.gen.ts", "**/worker-configuration.d.ts", "third_party/**", ".agents/**"
  ],
  "rules": {
    "typescript/no-explicit-any": "error",
    "typescript/no-non-null-assertion": "error",
    "typescript/consistent-type-imports": "error",
    "typescript/ban-ts-comment": ["error", { "ts-expect-error": "allow-with-description" }],
    "react-hooks/rules-of-hooks": "error",
    "react-hooks/exhaustive-deps": "warn",
    "react/jsx-key": "error",
    "import/no-cycle": "error",
    "import/no-duplicates": "error",
    "no-console": ["error", { "allow": ["warn", "error"] }],
    "eqeqeq": "error",
    "no-restricted-imports": ["error", {
      "paths": [
        { "name": "drizzle-orm/neon-serverless", "message": "(keep existing message)" },
        { "name": "@neondatabase/serverless", "message": "(keep existing message)" },
        { "name": "@tabler/icons-react", "message": "Use the canonical icon library." }
      ],
      "patterns": [{ "group": ["@garden/*/src/*"], "message": "Import through the package exports map." }]
    }]
  },
  "overrides": [
    { "files": ["**/*.test.ts", "**/*.test.tsx"], "rules": { "typescript/no-non-null-assertion": "off", "no-console": "off" } },
    { "files": ["scripts/**", "**/scripts/**", "*.mjs"], "rules": { "no-console": "off" } }
  ]
}
```

- Run oxlint with `--report-unused-disable-directives` so the dead suppressions get cleaned up.
- Start with the new rules at `warn` and use a ratchet (fail CI only when the count rises). Promote them to `error` once the backlog is cleared.
- Once logging is on `createGardenLogger`, tighten `no-console` to allow nothing.
- `any` stays banned in tests too; use the typed mock helpers from §3.1.

### 5.2 TypeScript

- `apps/web/tsconfig.options.json`: add `"extends": "@garden/tsconfig/react-library.json"`.
- Add the following to `packages/tsconfig/base.json`:
  - `noImplicitOverride`
  - `noFallthroughCasesInSwitch`
  - `verbatimModuleSyntax`
  - `noUncheckedSideEffectImports`
  - `exactOptionalPropertyTypes` (phase this one in)
- Remove `declaration`, `declarationMap` and `sourceMap` from the base; nothing emits.
- Add `apps/web/tsconfig.test.json` (with `types: ["vitest/globals"]`) and add it to the `typecheck` script.
- Reference the base the same way everywhere: `@garden/tsconfig/*`, declared as a devDependency.

### 5.3 CI additions

1. Run `pnpm format`, widened to the repo root with ignores for generated files.
2. Lint the root-level scripts and config files.
3. Run `worker:types:check` (or `git diff --exit-code` after generation), plus `verify:deploy-config`.
4. Run gitleaks, with the action pinned by SHA.
5. Check DB migrations:
   - journal lint (unique idx, monotonic `when`, unique prefixes)
   - `drizzle-kit check`
   - fresh `migrate` against Postgres
   - a `generate` that must produce no diff
6. Run `syncpack lint` / `manypkg check` (catalog compliance, consistent versions) and `knip` (unused files, exports and dependencies).
7. Add a grep-based design lint over `apps/web/src/features/**` and `packages/ui/**`. It fails on:
   - raw palette classes (`(bg|text|border)-(red|blue|gray|zinc|…)-\d`)
   - hex values in TSX
   - `[color:var(`
   - `text-[\d`
   - legacy token names

   Alternatively, adopt `eslint-plugin-better-tailwindcss`.
8. Add a doc-link check that every repo path cited in `docs/**` exists.
9. Remove the duplicate typecheck from the web `build`, and run CI only once per PR.

---

## 6. Remediation roadmap

Each phase can be split into small, independently reviewable PRs.

### Phase 0: Security and data integrity (immediately)
- File a private advisory, then fix D1 and D2: permission enforcement through the route wrapper, same-workspace checks, safe file serving, the proxy header allowlist, and a dedicated internal secret or a service binding.
- D3: change `issue_comment.issue_id` (and decide on `issue.parent_id`) to `ON DELETE CASCADE`, and add an index.
- D4: repair the migration journal, then freeze history and add the CI migration checks.
- D5: delete `createDb` and `getDb`, and pass the request-scoped DB.
- D6: always reschedule the cron in a finally-equivalent step.
- D7–D12: small frontend and server fixes.
- Add authorization tests (member, admin, non-member) for every mutating route.

### Phase 1: Enforcement baseline (weeks 1–2)
- Land the §5 lint, tsconfig and CI changes, with warnings ratcheted.
- Fix the Effect catalog conflict. Pin TanStack via the catalog. Collapse duplicate dependency majors. Delete unused and phantom dependencies.
- Delete dead code:
  - the unused ai-elements files (about 8k lines) and their 6 dependencies
  - `onboarding.tsx`, `sidebar.tsx`, `direction.tsx`
  - the dead CSS
  - the 82 unused core types
  - the scaffold and wizard files
- Write the §4 conventions into `CONTRIBUTING.md`.

### Phase 2: Backend convergence (weeks 2–6)
- `apiRoute()` wrapper, migrated route by route (issues first).
- Move data access into `packages/server` repositories, with transactions and a single `toIssue`.
- Typed env via `@garden/env`, and logger-only logging.
- Schema convention migration: timestamptz, NOT NULL timestamps, ON DELETE policy, FK indexes, enum CHECKs, typed JSONB, vocabulary (`member`, `cancelled`).
- Make `core` a leaf package with honest DTOs.

### Phase 3: Agent runtime (in parallel with Phase 2)
- A shared `RunSubAgentBase`, which removes about 1,000–1,300 duplicated lines.
- One `evaluateToolPermission` in core.
- An Effect↔Result adapter and the `defineAgentTool` helper.
- A shared provider REST client: timeouts, retries, token caching.
- Versioned DO storage migrations.
- Move prompts to assets.
- Tests for the four largest files.

### Phase 4: Frontend and design system (weeks 4–10)
- Token cleanup: fix the duplicate names, namespace the primitives, migrate the 24 legacy-token files, delete `LEGACY_COMPAT`, and reset Tailwind's default scales.
- Generate scoped themes and a JS token export, then delete the hand-copied palettes (feature CSS, emails, the appearance tab).
- One icon library, and use the shared primitives (Dialog, Spinner, Tooltip, Tabs, PageHeader).
- Break up the god components, starting with `issue-detail.tsx`, using the standard feature layout and per-domain query factories.
- Consolidate the formatters, Markdown, PDF and highlighter implementations into shared modules.
- Rewrite `docs/design.md` from `tokens.json`.

---

## 7. Appendix: metrics

| Metric | Value |
|---|---|
| TS/TSX files (excluding generated) | 904 |
| Lines of code | ~161,000 |
| Files > 1,000 lines | 18 |
| Explicit `any`: production / tests / generated | 15 / 46 / 127 |
| `as unknown as` | 77 |
| Lint suppressions (most target disabled rules) | 24 |
| `console.*` in runtime code | 83 |
| Error-handling paradigms in use | 4 (Result, Effect, throw, null) |
| Validation libraries | 2 + raw JSON Schema + hand-written checks |
| HTTP error response shapes | 6 |
| API stacks | 3 |
| DB client factories | 5 |
| Timestamp columns with time zone | 16 / 85 |
| FKs with `ON DELETE no action` | 59 / 92 |
| Typed JSONB columns | 2 / 31 |
| Migrations mixing data changes | 16 / 48 |
| Unused exported core types | 82 / 128 |
| Token vocabularies live | 3 |
| Distinct font sizes (token scale = 10) | 34 |
| Icon libraries | 3 |
| Dead vendored ai-elements | ~25 / 49 files (~8k lines) |
| API routes with any test | 14 / 91 |
| Web test files type-checked | 0 / 66 |
| Committed agent-skill files | 454 |

*Counts come from ripgrep and git scans of the working tree. Small differences between sections reflect slightly different scopes, such as whether tests or vendored files were included.*
