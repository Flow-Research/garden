# Chat Switching Architecture

**Status:** current implementation note
**Last reviewed:** 2026-05-24

This note documents the low-latency chat switching path after the runtime registry was simplified. Chat data is durable in Think/Postgres; the active panel opens the websocket it needs. There is no global warm runtime provider today.

## Ownership

| Concern | Owner | Evidence |
| --- | --- | --- |
| Active dock panel and tab/panel persistence | `WorkspaceDockProvider` / Dockview | `apps/web/src/components/shell/workspace-dock.tsx` |
| Active chat selection signal | `useChatStore.activeSessionId` | `packages/app-state/src/chat/store.ts`, `workspace-dock.tsx` commits panel state into store |
| Chat session list and warm first-turn bookkeeping | `useAgentSessions` + React Query/cache/store | `apps/web/src/features/chat/use-agent-chat-sessions.ts` |
| Live chat websocket | Mounted `AgentInteractionScreen` via `useChatRuntimeConnection()` | `apps/web/src/features/chat/components/agent-interaction-screen.tsx`, `chat-runtime-provider.tsx` |
| Runtime connection | `useAgent({ agent: 'AgentDO', name, sub: [{ agent: 'ChatSubAgent', name: runtime_key }] })` + `useAgentChat` | `apps/web/src/features/chat/chat-runtime-provider.tsx:102-144` |
| Transient panel UI | `ConnectedChatPanelInteraction` / controller-local state | `apps/web/src/features/chat/components/chat-panel-controller.tsx` |
| Timeline rendering | `Conversation` / chat timeline components | `apps/web/src/features/chat/components` |

`ChatRuntimeProvider` remains mounted in `WorkspaceLayout`, but it currently renders `children` only. Do not rely on it as a runtime registry unless code is added for that purpose.

## Click-to-render path

For a normal existing chat row click:

1. Sidebar calls `openPanel({ kind: 'chat', entityId: session.id, ... })`.
2. `WorkspaceDockProvider.openPanel` activates or retargets a chat panel.
3. Panel state writes the selected chat id into `useChatStore`.
4. `AgentInteractionScreen` resolves the active session from store/panel params.
5. The mounted panel calls `useChatRuntimeConnection({ session })`.
6. `useAgent` connects to `AgentDO` and `ChatSubAgent(runtime_key)`.
7. `useAgentChat` receives durable Think messages/stream state.

Switching to a chat that already has cached metadata should update shell/sidebar selection immediately. The live websocket still belongs to the mounted panel.

## URL sync

The URL is still persistence/shareability, not the fast-path render source. In-app chat selection should route through Dockview/open-panel state, then query state. Avoid adding a second URL/store bridge that races Dockview.

## Remount rules

Avoid React `key` as a general reset tool in the chat switch path.

Known expensive remounts to avoid:

- keying `AgentInteractionScreen` by session id;
- keying `ChatPanelInteraction` by session id;
- keying the inner virtualized timeline by a synthetic activation counter.

The acceptable boundary is the mounted panel's own connection changing when the selected session changes.

## Session-scoped UI reset

Local controller UI state may reset on `sessionId` before paint when needed:

- approval errors;
- resolving/resolved approval ids;
- retry flags;
- document panel view;
- resolved document edit status map;
- optimistic pending turn refs/state.

Do not move this transient state into global stores only to avoid remounts.

## Runtime implications

- Only mounted chat panels maintain live websocket connections.
- Hidden/unopened chats rely on Think durability and are reattached when opened.
- If product requires one always-warm workspace-level chat registry, implement it explicitly and update `ChatRuntimeProvider` from pass-through to real owner.
- Do not emulate warmth by switching `this.session` inside one `Think` instance; use `AgentDO` + `ChatSubAgent` routing.

## Checkpoints

When changing this area, verify:

- clicking a cached chat updates highlighted row and panel chrome immediately;
- the runtime connection uses `AgentDO` with `ChatSubAgent(runtime_key)`;
- existing chat switches do not require remounting the whole workspace shell;
- document-panel and approval local state reset only for the selected session;
- `pnpm --filter @garden/web typecheck` passes.
