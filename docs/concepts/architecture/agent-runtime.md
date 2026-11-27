---
title: The agent runtime gives each chat and run its own Think facet
description: Why Garden runs one AgentDO per agent with a Think sub-agent per chat, issue, and automation run, and where each piece of state lives.
status: current
owner: "@Umoren"
last_reviewed: 2026-11-03
---

Garden runs agents on Cloudflare Agents and `@cloudflare/think` 0.10.0. Durable Objects give each agent an identity. Cloudflare Workflows keep long-running work alive. Postgres stays the queryable control plane that lists chats, issues, and runs.

The core choice is one parent `AgentDO` per agent, with one Think sub-agent (a facet) per unit of work. Each chat thread, issue run, and automation run gets its own facet and its own SQLite scope. This page explains that shape and the rules that protect it.

## One parent, many facets

The runtime splits into the pieces below. All classes live in `packages/agent-runtime/src/`.

| Piece | Class | Keyed by |
| --- | --- | --- |
| Agent identity and RPC parent | `AgentDO extends Agent` in `agent-do.ts` | `agent.hostName` or the agent id |
| Chat conversation | `ChatSubAgent extends Think` in `agent-do.ts` | chat thread `runtime_key` |
| Issue work | `IssueRunSubAgent` in `issue-run-sub-agent.ts` | issue id |
| Automation work | `AutomationRunSubAgent` in `automation-run-sub-agent.ts` | automation run id |
| Durable run coordination | `RunWorkflow` in `run-workflow.ts` | run id as the Workflow instance id |
| Schedule trigger state | `AutomationTriggerDO` in `automation-trigger-do.ts` | automation |

`IssueRunSubAgent` and `AutomationRunSubAgent` both extend `RunSubAgentBase` in `run-sub-agent-base.ts`. The parent creates and routes every facet with `this.subAgent(ChildClass, name)`. The Durable Object and Workflow bindings are declared in `apps/web/wrangler.jsonc`. See the [architecture map](../../reference/architecture-map.md) for the full binding list.

## Chats are facets, not sessions

The browser connects to the parent and names the child in the same call. `apps/web/src/features/chat/chat-runtime-provider.tsx` does this:

```ts
useAgent({
	agent: 'AgentDO',
	name: session.hostName,
	sub: [{ agent: 'ChatSubAgent', name: session.runtime_key }],
})
```

On the server, `AgentDO` reaches the same child with `await this.subAgent(ChatSubAgent, threadId)`. Before it creates or routes a child, the parent checks that the `chat_thread` row belongs to this agent.

Think also offers `SessionManager` and `Session.forSession(id)`, so one Think instance could in theory switch between chats. Garden does not do that. When a Think instance starts, it installs one live `this.session`, a message listener, a cached prompt, and an in-memory message cache. Swapping `this.session` later does not rebuild that state, and two chat panels open at once would race on it. A facet per chat removes the race, and it matches the `subAgents` model that Cloudflare recommends for multi-chat agents.

`listSessions()` follows from that choice. It sees only one facet's storage, so it cannot list a workspace's chats. The sidebar reads Postgres through `apps/web/src/routes/api/chat/threads.ts` and `apps/web/src/lib/api/chat-threads.ts`.

## Postgres owns metadata, the facet owns live state

Postgres table `chat_thread` (`packages/db/src/schema/chat.ts`) holds what the product needs to query:

- `id`, `workspace_id`, `owner_user_id`, and `agent_id`
- `runtime_kind` and `runtime_key`, which route to the facet
- `primary_issue_id`
- title, last message, archive time, and timestamps

The `ChatSubAgent` facet owns the live Think state. That covers message persistence, the thread's Shell `Workspace`, document tools, MCP registrations, and sandbox options for that chat.

Because each facet has its own SQLite scope, messages, workspace files, loaded skill files, MCP connection rows, and document artifacts are per chat. Nothing is shared unless it is moved up to the parent `AgentDO` or to another shared Durable Object.

## Share a resource by moving it up

When a product need requires sharing, move up only the resource that needs it:

- Shared files: a parent-owned `Workspace` that child facets reach through RPC.
- Shared MCP: a parent-owned MCP controller or registry, with execution wrappers in each child.
- Shared memory or search: a parent-owned provider that children call.

Do not merge chats into one mutable Think instance to get sharing. That brings back the session race instead of modeling the shared resource. Shared files, shared memory, a global artifact bucket, and a Workspace-to-container bridge are not built. Each waits for a concrete product workflow or a measured failure.

## Long-running work runs through Workflows

Issues and automations are separate product ledgers. They share one durable execution boundary, `RunWorkflow`, which drives Think durable submissions one turn at a time. `RunSubAgentBase` sends each turn with `submitMessages()`, and the Workflow waits on the event that `onSubmissionStatus` emits. Garden does not keep its own waiter maps, recovery queues, or transcript repair loops. The [run engine](./run-engine.md) page covers this in full.

## Prompts are layered contexts

Each facet builds its prompt in `configureSession()` as named Think contexts, then calls `withCachedPrompt()`. Skills come from `getSkills()`, which calls `loadRuntimeSkillSources` in `skills.ts` to load assigned skills from R2.

Chat (`ChatSubAgent.configureSession`) uses these layers:

1. `foundation` from `packages/agent-runtime/src/instructions/`.
2. `agent` from the Postgres agent row: name, role title, and instructions.
3. `workspace` from the organization name and context.
4. Assigned skills from `getSkills()`.

Issue and automation runs (`RunSubAgentBase.configureSession`) use these layers:

1. `foundation`.
2. A run-specific context: `issue-interaction` for issues, which uses the bundled skill in `packages/agent-runtime/src/skills/issue-interaction/`, or `automation-run` for automations.
3. Assigned skills from `getSkills()`.

Keep prompt text stable so the cached prompt stays valid. Expose changing capability state through bounded tools instead.

## Codemode and the sandbox are separate

Chat and run facets use Think codemode through `createExecuteTool` and the `LOADER` Worker Loader binding. Garden's `sandbox*` tools run in a Cloudflare Sandbox container instead. The two do not share files. The [execution runtimes](./execution-runtimes.md) page explains when to use each.

## Design rules

These rules follow from the shape above:

- Do not monkey-patch SDK lifecycle methods.
- Do not switch live Think chats by changing `this.session`.
- Do not put a queue between `AgentDO` and `RunWorkflow` unless a documented Cloudflare platform gap requires one.
- Use Think `submitMessages()` for server-driven run turns.
- Keep app-wide realtime separate from agent and chat WebSocket streams. See [realtime](./realtime.md).
