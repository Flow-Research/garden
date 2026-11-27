---
title: Chat opens one live connection per visible thread
description: How a chat thread maps to a Think facet, how the web app connects to it, and why only the visible thread and one prewarmed thread hold sockets.
status: current
owner: "@Umoren"
last_reviewed: 2026-11-03
---

A chat thread is a conversation between you and one agent. Its metadata lives in the Postgres `chat_thread` table. Its messages live in a Think facet, `ChatSubAgent`, under the agent's `AgentDO`. The facet is named by `chat_thread.runtime_key`. For a thread linked to an issue, `runtime_key` equals the issue ID.

## The router decides which chat is visible

Chats are routes. `/chats` shows the composer for a new chat. `/chats/$threadId` renders `AgentInteractionScreen` for one thread, from `apps/web/src/routes/_authenticated/_app/chats.$threadId.tsx`. The router is the source of truth for the visible thread. No store or dock state competes with it.

Open chats appear as tabs above the content. `useSurfaceTabsStore` in `packages/app-state/src/surface-tabs/store.ts` keeps an ordered list of open tabs per surface and persists it per workspace, so a reload restores the strip. The store holds no routing logic. Selecting or closing a tab navigates the router.

## The visible screen owns the live connection

`useChatRuntimeConnection` in `apps/web/src/features/chat/chat-runtime-provider.tsx` opens the socket where the screen uses it. It connects in two parts:

- `useAgent({ agent: 'AgentDO', name: session.hostName })` reaches the agent's parent runtime.
- `useAgent` with `sub: [{ agent: 'ChatSubAgent', name: session.runtime_key }]`, passed to `useAgentChat`, reaches the thread's Think facet and its message stream.

Hidden and unopened threads hold no socket. Think keeps their messages durable, and they reattach when you open them. This keeps idle socket, facet, and MCP load low.

## Sends wait for the first history sync

Think sends the thread history as a `cf_agent_chat_messages` frame when a socket connects, and `useAgentChat` applies that frame by replacing its messages. A message sent on a new thread before that frame arrived used to be replaced by the empty history and lost. `createHistorySyncGate` now holds sends until the first `cf_agent_chat_messages` or `cf_agent_stream_resuming` frame arrives. Later sends pass straight through.

## One unopened thread is prewarmed

`ChatRuntimeProvider` mounts once in `AppShell`. It claims a warm session through `useAgentSessions` (`apps/web/src/features/chat/use-agent-chat-sessions.ts`) and renders `ChatRuntimeWarmConnection` for it. That component opens the parent and facet sockets and calls `AgentDO.warmThreadRuntime`, so the next new chat starts without a cold facet.

The provider skips prewarming when the warm thread is already visible, or when you are on the `/chats` composer, which mounts the warm session itself. Without that guard, an idle new chat held two parent sockets and two facet sockets.

## Switching threads keeps the shell mounted

Switching chats changes the route and the session passed to `useChatRuntimeConnection`. The shell and the timeline component stay mounted. Avoid React `key` resets on `AgentInteractionScreen`, `ChatPanelInteraction`, or the virtualized timeline. Each one forces an expensive remount.

Some state belongs to one thread and resets when `sessionId` changes: approval errors, resolving and resolved approval IDs, retry flags, the document panel view, document edit statuses, and optimistic pending turns. That state stays local to `chat-panel-controller.tsx`. Moving it into a global store only to avoid remounts would leak it across threads.

## The server routes by facet, never by session swap

On the server, each thread is its own `ChatSubAgent` facet. Garden never switches one Think instance between threads by mutating `this.session`. The [agent runtime](../architecture/agent-runtime.md) page explains the facet model.

## Chat hosts several feature surfaces

The chat timeline renders more than messages. Each of these has its own page:

- Document artifacts open in the chat document panel. See [artifacts](./artifacts.md).
- Decide analyses render as a status card. See [Decide](./decide.md).
- Tool approvals render inline through `use-tool-approvals.ts`. See [permissions](./permissions.md).
- Skills load on demand during a turn. See [skills](./skills.md).
