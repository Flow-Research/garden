# Chat runtime model

**Status:** current implementation
**Last reviewed:** 2026-05-24

Garden chat uses the upstream Think/Agents multi-chat shape: one parent `AgentDO` for an agent runtime identity, with one `ChatSubAgent` facet per product chat thread.

This is not a gap or workaround. It is the codebase's intended concurrency model and matches the current Cloudflare direction for `subAgents <> sessions`.

## Code-backed decision

| Concept | Current code | Evidence |
| --- | --- | --- |
| Agent runtime identity | `AgentDO` is keyed by `agent.hostName` or the agent UUID | `packages/db/src/schema/agents.ts`, `packages/agent-runtime/src/agent-do.ts:285` |
| Product chat metadata | Postgres `chat_thread` binds a thread to `agent_id`, `runtime_kind`, and `runtime_key` | `packages/db/src/schema/chat.ts` |
| Chat runtime facet | Parent delegates each thread to `subAgent(ChatSubAgent, threadId)` | `packages/agent-runtime/src/agent-do.ts:299-477` |
| Browser connection | UI connects to `AgentDO` with `sub: [{ agent: 'ChatSubAgent', name: session.runtime_key }]` | `apps/web/src/features/chat/chat-runtime-provider.tsx:102-112` |
| Access control | Parent checks `chat_thread.agentId` plus `id/runtimeKey` before creating or routing a child | `packages/agent-runtime/src/agent-do.ts:813-836` |
| Chat discovery | Sidebar/list APIs read Postgres, not Think session storage | `apps/web/src/routes/api/chat/threads.ts`, `apps/web/src/lib/api/chat-threads.ts` |

## Why not mutable `this.session`

`SessionManager` and `Session.forSession(id)` are useful storage primitives, but Think installs one live `this.session`, message listener, cached prompt path, and in-memory message cache when a `Think` instance starts. Switching `this.session` after startup would race concurrent chat panels and does not rebuild all runtime state.

Keep product chat isolation at the facet boundary:

```ts
useAgent({
  agent: 'AgentDO',
  name: session.hostName,
  sub: [{ agent: 'ChatSubAgent', name: session.runtime_key }],
})
```

and on the server:

```ts
await this.subAgent(ChatSubAgent, threadId)
```

## Source of truth

Postgres owns product metadata:

- `chat_thread.id`
- `chat_thread.workspace_id`
- `chat_thread.owner_user_id`
- `chat_thread.agent_id`
- `chat_thread.runtime_kind`
- `chat_thread.runtime_key`
- `chat_thread.primary_issue_id`
- `title`, `last_message`, `archived_at`, timestamps

The `ChatSubAgent` facet owns live Think chat state, message persistence, the thread-local Shell `Workspace`, document tools, MCP registrations, and sandbox options for that chat.

## `listSessions()` scope

`listSessions()` is local to one durable object/facet. It is not the workspace chat registry and should not drive the sidebar. The sidebar should continue to use Postgres APIs.

## Shared-state boundary

The current model intentionally gives each `ChatSubAgent` its own SQLite scope. That means chat messages, workspace files, materialized skill files, live MCP connection rows, and document artifacts are per-chat unless a surface is explicitly hoisted to the parent `AgentDO` or another shared Durable Object.

Correct future patterns:

- shared files: parent-owned `Workspace` plus child proxy/RPC;
- shared MCP: parent-owned MCP controller/registry plus child execution wrappers;
- shared memory/search: parent-owned context or search provider consumed by children.

Do not collapse chats into one mutable Think instance to get sharing. That would reintroduce session races instead of modeling the shared resource directly.
