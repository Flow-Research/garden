# Realtime Sync

**Status:** implemented — workspace-scoped realtime hub (`WorkspaceRealtimeDO`).

## Architecture

| Piece | Where |
| --- | --- |
| Hub (one Durable Object per workspace, hibernating WebSockets) | `packages/agent-runtime/src/workspace-realtime-do.ts` |
| Audience gating (pure) | `packages/agent-runtime/src/realtime-audience.ts` |
| Connect route (`/api/realtime`, session + membership auth) | `apps/web/src/lib/server/realtime.ts`, wired in `apps/web/src/server.ts` |
| Publishers (fire-and-forget after successful writes) | Teams + issue API routes via `publishWorkspaceEvent` |
| Client channel (store-subscription driven, no effects) | `apps/web/src/lib/realtime/realtime-manager.ts` |
| Event contract | `packages/core/src/types/events.ts` (`RealtimeEventEnvelope`, `RealtimePublishableEvent`) |

Flow: a route writes to Postgres, then publishes an envelope
(`{ event_id, type, workspace_id, published_at, payload }`) to the workspace hub.
The hub applies per-connection audience rules and sends only to eligible
sockets. Clients never render payloads directly — they invalidate React Query
roots (`['teams', wsId]`, `['issues', wsId]`) so every refetch goes through the
normal access-checked APIs.

## Audience rules (spec §8)

- Workspace owners/admins receive everything.
- `team:*` / `team_member:*` → Team members only.
- `issue:*` with a `team_id` → Team owner, or a member only when assigned.
- `issue:*` without a `team_id` → every workspace member.
- Non-eligible connections receive nothing; connection profiles refresh from
  Team events (member add/remove, owner transfer, deletion) so long-lived
  sockets stay accurate without per-delivery database reads.

## Instrumentation

- `realtime.published` (route) and `realtime.delivered` (hub, with
  `publishToDeliverMs`) logs carry the event id.
- The client captures `realtime_event_applied` in PostHog with
  `publish_to_invalidate_ms` — together these measure publish → deliver →
  cache-update latency against the p95 < 500 ms target.

## Reconnect

The client reconnects with capped exponential backoff; on a reconnect it
invalidates the Teams and issues roots so the active Team and tab refetch.
Unauthorized closes (1008/4001/4003) stop the loop until the session changes.

## Non-goals

- No reuse of chat websocket traffic; chat keeps its own Agents SDK channel.
- No new event types beyond the published Team/issue set; other contract types
  (inbox, comments, runs) can publish through the same hub when wired.
