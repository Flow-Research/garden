# Realtime Sync

Garden currently has agent/chat streaming, issue-run polling, and dormant app-wide websocket plumbing. It does **not** have a workspace-wide realtime publisher or Durable Object bus.

## Current code state

| Surface | State | Evidence |
| --- | --- | --- |
| Chat streaming | Live through Agents/Think websocket for the mounted chat panel | `apps/web/src/features/chat/chat-runtime-provider.tsx`, `useAgent` + `useAgentChat` |
| Issue active run/events | TanStack Query polling while a run is active | `apps/web/src/lib/issues/queries.ts` (`refetchInterval: 2000`) |
| Inbox | Periodic query polling | `apps/web/src/lib/inbox/queries.ts` (`refetchInterval: 60_000`) |
| App-wide WS client | Library exists but host app passes no `wsUrl`, so it is inactive | `packages/app-state/src/realtime/provider.tsx`, `apps/web/src/components/web-providers.tsx` |
| Workspace-wide DO bus | Not bound | `apps/web/wrangler.jsonc` has `AgentDO`, `Sandbox`, `AUTOMATION_TRIGGER`, `MCP_SESSION`; no `BroadcastHub` / `WorkspaceRealtimeAgent` |

## Gaps

| Gap | Severity | Notes |
| --- | --- | --- |
| No workspace-wide realtime Durable Object or service binding exists. | High | Add only when a product surface needs cross-client fanout beyond polling. |
| No server-side publisher emits normalized workspace events after Postgres writes. | High | Current write paths rely on query invalidation, polling, and mounted chat streams. |
| App shell does not pass `wsUrl` into `CoreProvider`, so `WSProvider` is dormant. | Medium | This is intentional until the bus exists; do not invent a fake URL. |
| Issue title updates do not sync dock tab titles through realtime. | Low | Existing TODO in `workspace-dock.tsx`; can be solved by mutation update or future bus. |
| Document edit status cross-client sync needs document events. | Medium | Current document UI handles local optimistic updates; multi-client sync is future bus work. |

## Upgrade path

The next real layer should be a workspace-scoped realtime coordinator, not the chat channel:

```md
WorkspaceRealtimeAgent or BroadcastHub
  name: workspaceId
  owns: websocket clients, presence, normalized invalidation/patch fanout
  does not own: durable business records or AI chat state
```

After a successful Postgres write, server routes would emit normalized events such as `query.invalidate` or `entity.patch`. Clients reconcile through TanStack Query. Chat/agent streams remain on the Agents/Think path.

## Non-goals

- Do not mix app-wide realtime into `ChatSubAgent` websocket traffic.
- Do not use a fake `/ws` transport to satisfy old hooks.
- Do not add a queue/effect layer for issue/automation run progress; `RunWorkflow` + polling is the current durable boundary.
