---
title: Scope each Executor MCP session to one Garden runtime
description: Decision record from October 2026 to give every agent runtime its own Executor MCP Durable Object, and what shipped in phase 1.
status: decision
owner: "@Flow-Research/security"
last_reviewed: 2026-11-03
---

**Date:** October 2026. **Outcome:** phase 1 shipped in PR #239 on 2026-10-26.

## Context

Garden runs Executor v1.5.40 inside its web Worker. Each agent runtime reaches Executor tools through an MCP server that the Agents SDK (`agents` 0.17.3) connects over RPC.

Before this decision, every runtime registered that server with the same name:

```text
Agent runtime -> addMcpServer("executor") -> rpc:executor -> one Durable Object
```

The Agents SDK resolves an RPC MCP server by its remote name, and PartyServer maps that name to a Durable Object id. The first session initialized that one Durable Object with its own workspace and user. Later calls from other workspaces or users could reach the same initialized Executor runtime, which was not rebuilt for them.

That could mix workspace identity, user identity, connection state, pending MCP requests, and direct Decide sessions across tenants. It also made a transport timeout look like a provider failure while the real work continued.

## Decision

Garden made these choices:

- Keep the in-process Executor v1 integration. Do not start an Executor v2 migration as part of this change.
- Give each runtime its own Executor MCP Durable Object by putting the runtime identity in the remote name.
- Keep `executor` as the local MCP server id, so Garden tool keys do not change.
- Keep one Decide execution path, the direct adapter in `apps/web/src/lib/server/executor-engine/direct-decide-mcp.ts`. The nested Executor MCP route for Decide was unreliable, and two production paths would make failures and billing hard to trace.

The remote name has this shape:

```text
executor:<workspaceId>:<userId>:<agentId>:<threadId>:<issueId or "chat">:<runId or "session">
```

The remote name is an address, not an authorization boundary. Garden still resolves identity from product state, passes it to Executor, and enforces permissions at its API and tool boundaries.

## What shipped in phase 1

`buildExecutorMcpServerName` in `packages/agent-runtime/src/runtime-mcp-controller.ts` builds the scoped name from `ThreadRuntimeIdentity`. `RuntimeMcpController.ensureProxyMcpConnections` registers the server under local id `executor` with that name. If a stored registration has a different name, such as the old global `rpc:executor`, the method removes it before it adds the scoped one. `packages/agent-runtime/src/mcp-connectors.test.ts` covers the name function.

The direct Decide adapter reuses one official MCP client per connection. It drops the session after a failed call or a disconnect, returns typed `DirectDecideMcpError` failures, and does not retry analysis calls.

## Consequences

Two runtimes with different identities never share an Executor MCP Durable Object. A runtime that wakes with the old global registration moves to its scoped name.

Each chat thread and each run now gets its own Executor session. That means more Durable Objects and colder starts per thread, in exchange for no shared state across tenants.

The decision left a timeout mismatch open: the outer Agents RPC allowed 4 minutes 30 seconds, and the direct Decide call allowed 5 minutes. The record said that long Decide analyses should move to a Workflow instead of longer nested timeouts. That happened in PR #242 on 2026-10-30. Decide analysis now runs as a durable Workflow in `apps/web/src/decide-analysis-workflow.ts`, and `DECIDE_ANALYSIS_TIME_LIMIT_MS` in `direct-decide-mcp.ts` allows one hour per analysis.

## Later phases

The plan named three later phases. They are not done:

1. **Transport proof.** Test against the Worker runtime with two workspaces at once, two users in one workspace, concurrent tool calls, a hibernation and wake cycle, a stale `rpc:executor` registration, Decide progress, and OAuth token refresh.
2. **Connector cleanup.** Make the connector id to Executor slug mapping canonical, reconcile capability sync with workspace-owned connections, remove unused per-connector MCP state, make unknown hosted tools fail closed, and add transport fields to runtime telemetry.
3. **Executor v2 evaluation.** Only after the transport proof passes. Executor v2 could replace the integration plane, but it does not replace Garden's runtime scoping.

## Sources

- `packages/agent-runtime/src/runtime-mcp-controller.ts`
- `packages/agent-runtime/src/agent-do.ts` and `packages/agent-runtime/src/run-sub-agent-base.ts`
- `apps/web/src/lib/server/executor-engine/mcp.ts`
- `apps/web/src/lib/server/executor-engine/direct-decide-mcp.ts`
- [Connectors](../concepts/architecture/connectors.md)
- [Executor MCP documentation](https://executor.sh/docs/mcp)
