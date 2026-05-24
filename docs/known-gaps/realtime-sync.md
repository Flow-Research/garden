# Realtime Sync

**Status:** evidence-triggered deferral; no active Flow Research issue.

Garden has live Agents/Think streaming for mounted chat panels and bounded polling/refetch for issue runs and inbox state. It does not have a workspace-wide realtime publisher or Durable Object bus.

## Current behavior

| Surface | State | Evidence |
| --- | --- | --- |
| Chat | Live websocket for mounted chat panel | `apps/web/src/features/chat/chat-runtime-provider.tsx` |
| Active issue run/events | Polls every two seconds while active | `apps/web/src/lib/issues/queries.ts` |
| Inbox | Periodic query polling | `apps/web/src/lib/inbox/queries.ts` |
| App-wide websocket client | Dormant because host app provides no `wsUrl` | `packages/app-state/src/realtime/provider.tsx`, `apps/web/src/components/web-providers.tsx` |
| Workspace realtime binding | None | `apps/web/wrangler.jsonc` |

## Decision

Do not treat workspace-wide realtime as an active P0. Current streaming, query invalidation, and polling are acceptable until beta use shows stale-state or latency pain. Local mutation cache updates can fix isolated UI gaps without creating a global bus.

If measured need appears, add a workspace-scoped coordinator keyed by `workspaceId` that fans out normalized invalidation or patch events after successful Postgres writes. It must not own durable business records or reuse chat websocket traffic.

## Non-goals

- No fake `/ws` transport for dormant hooks.
- No app-wide event layer inside `ChatSubAgent`.
- No queue/recovery layer around issue or automation progress; `RunWorkflow` remains the durable boundary.
