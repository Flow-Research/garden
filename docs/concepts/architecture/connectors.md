---
title: Connectors run through Executor inside the Garden Worker
description: How Garden installs external integrations, gates their tools, and exposes them to agents through scoped Executor MCP sessions and the direct Decide path.
status: current
owner: "@Flow-Research/security"
last_reviewed: 2026-11-03
---

Garden has one application Worker. Executor v1.5.40 (`@executor-js/sdk` and its plugins in `apps/web/package.json`) runs inside that Worker. Executor handles the connector catalog, installation, OAuth, connections, execution, and hibernating MCP sessions. Garden API routes call the Executor SDK directly. The Worker also exports Executor's MCP session and execution-owner Durable Objects, bound as `EXECUTOR_MCP_SESSION` and `EXECUTOR_MCP_EXECUTION_OWNER` in `apps/web/wrangler.jsonc`.

There is no separate connector Worker, connector service binding, or MCP proxy Worker. Keeping Executor in-process means one deploy, one set of bindings, and no extra network hop for each tool call.

## Garden owns policy, Executor owns the engine

The work splits between the two like this:

| Concern | Owner |
| --- | --- |
| Workspace and member identity | Garden Postgres and the runtime identity resolver |
| Permission grants, approvals, and audit | Garden |
| Provider policy and native tool definitions | Garden, in `packages/connectors/src` |
| GitHub App and Discord bot installation | Garden |
| Catalog projection and presets | Garden, in `apps/web/src/lib/server/executor-engine/` |
| Provider catalog and OAuth connections | Executor |
| Encrypted provider credentials | Executor |
| Remote MCP, OpenAPI, and GraphQL execution | Executor |
| MCP session warm state | A scoped `ExecutorMcpSession` Durable Object |

The registered connectors are `discord`, `github`, `gmail`, `google-drive`, and `slack`. GitHub and Discord are Garden-native: their tools run through typed Effect services in Garden. The other integrations run through Executor.

## State lives in three places

Executor stores integration and connection state in the `EXECUTOR_DB` D1 database and blobs in the `EXECUTOR_BLOBS` R2 bucket. Garden's Postgres database stores workspace product state: accounts and installations, capabilities, permission grants, approval requests, and tool-call audit rows. Durable Objects keep agent and MCP session state.

## Every tool has a risk class and a trust level

`packages/connectors/src/sdk.ts` defines four risk classes: `read`, `write`, `send_external`, and `destructive`. An agent's trust level for a tool is `auto`, `allow`, or `ask`. `packages/connectors/src/capabilities.ts` maps a risk class to its default trust and resolves the effective trust for a connection.

Unknown tools fail closed. A tool with no risk class defaults to `ask`. Unclassified native or hosted GitHub tools are not exposed at all. Executor receives tenant and member identity from Garden, and it never replaces Garden's workspace authorization checks.

## Each runtime gets its own Executor MCP session

Installed Executor tools reach an agent through one MCP server per runtime. `RuntimeMcpController.ensureProxyMcpConnections` in `packages/agent-runtime/src/runtime-mcp-controller.ts` registers that server for every chat facet and run facet.

The local server id is always `executor`, so Garden tool keys stay stable. The remote name that the Agents SDK uses to address the Durable Object carries the runtime identity. `buildExecutorMcpServerName` builds it:

```text
executor:<workspaceId>:<userId>:<agentId>:<threadId>:<issueId or "chat">:<runId or "session">
```

Two runtimes with different identities therefore never share an Executor session. If a facet wakes with an older registration under a different name, the controller removes it and adds the scoped one. The name is an address, not an access check. Garden still enforces permissions at its API and tool boundaries. The [scoped Executor MCP sessions decision](../../decisions/2026-10-scoped-executor-mcp-sessions.md) records why.

## Decide takes a direct path

Decide is an Executor integration with its own execution path. `apps/web/src/lib/server/executor-engine/direct-decide-mcp.ts` adds a `directDecideMcp` Executor plugin, and `registerDirectDecideTools` puts the Decide tools on the Executor MCP server.

When a Decide tool runs, the plugin resolves the saved OAuth token inside Executor. Then it calls `https://api.trydecide.ai/mcp` with the official MCP client instead of going through Executor's nested MCP transport. The token stays inside the Worker. `DirectDecideMcpSessionManager` keeps one MCP client per connection, so request ids stay unique across calls. It drops the client after any failed call or disconnect. Analysis calls are not retried, because a retry could bill twice.

The `analyze` tool does not hold the agent's turn open. It starts a durable Decide analysis Workflow (`apps/web/src/decide-analysis-workflow.ts`, ledger table `decide_analysis_run`) through `makeDecideAnalysisStarter`. That Workflow allows up to `DECIDE_ANALYSIS_TIME_LIMIT_MS`, one hour, per analysis. See [Decide](../features/decide.md) for the product side.

Garden uses one Decide path on purpose. Two production paths for the same call would make failures and billing hard to trace.

## Add a connector

To add or change an integration, follow [add a connector](../../guides/develop/add-a-connector.md).
