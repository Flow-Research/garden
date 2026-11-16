---
title: Connectors run through Executor inside the Garden Worker
description: How Garden installs external integrations, gates their tools, and exposes them to agents through scoped Executor MCP sessions and the direct Decide path.
status: current
owner: '@Flow-Research/security'
last_reviewed: 2026-11-03
---

Garden has one application Worker. Executor v1.5.40 (`@executor-js/sdk` and its plugins in `apps/web/package.json`) runs inside that Worker. Executor handles the connector catalog, installation, OAuth, connections, execution, and hibernating MCP sessions. Garden API routes call the Executor SDK directly. The Worker also exports Executor's MCP session and execution-owner Durable Objects, bound as `EXECUTOR_MCP_SESSION` and `EXECUTOR_MCP_EXECUTION_OWNER` in `apps/web/wrangler.jsonc`.

There is no separate connector Worker, connector service binding, or MCP proxy Worker. Keeping Executor in-process means one deploy, one set of bindings, and no extra network hop for each tool call.

## Garden owns policy, Executor owns the engine

The work splits between the two like this:

| Concern                                     | Owner                                                 |
| ------------------------------------------- | ----------------------------------------------------- |
| Workspace and member identity               | Garden Postgres and the runtime identity resolver     |
| Permission grants, approvals, and audit     | Garden                                                |
| Provider policy and native tool definitions | Garden, in `packages/connectors/src`                  |
| GitHub App and Discord bot installation     | Garden                                                |
| Catalog projection and presets              | Garden, in `apps/web/src/lib/server/executor-engine/` |
| Provider catalog and OAuth connections      | Executor                                              |
| Encrypted provider credentials              | Executor                                              |
| Remote MCP, OpenAPI, and GraphQL execution  | Executor                                              |
| MCP session warm state                      | A scoped `ExecutorMcpSession` Durable Object          |

The registered connectors are `discord`, `github`, `gmail`, `google-drive`, and `slack`. GitHub and Discord are Garden-native: their tools run through typed Effect services in Garden. The other integrations run through Executor. Executor's `github-rest` and `github-graphql` presets stay disabled, so GitHub runs only through the Garden GitHub App installation (native tools and the Garden-hosted MCP server), never through sandbox HTTP or personal access token presets.

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

## Whose GitHub access a run uses

GitHub tools in a run come from the workspace GitHub App installation. They do not come from the member who triggered the run, and they do not come from the agent owner's personal GitHub account.

The GitHub binding does not depend on who triggered the run. `listAvailableConnectorBindings` in `packages/server/src/connectors/availability.ts` filters OAuth `account` rows by workspace and user, but it filters `github_app_installation` rows by workspace alone. The GitHub binding's `accountId` is the installation id. `RuntimeMcpController.refreshGitHubHostedMcpTools` passes that installation id to the hosted GitHub MCP client, and native GitHub tools authenticate as the same installation. GitHub therefore sees every run as the Garden App acting on the workspace installation, with whatever repositories that installation can reach.

Per-agent permission grants still decide which of those tools an agent may call. Member GitHub logins (`github_identity`) are used only to map Garden people to GitHub assignees, not to authenticate.

## Whose personal connections a run uses

Executor connections for Google Drive, Docs, Calendar, Meet, Gmail, Slack, and similar services carry an owner. An `org` connection is the workspace's deliberate company account. A `user` connection is one member's personal account. Before issue #383, every issue run read both kinds through the agent owner. On FLO-150, Samuel asked Garden for a Google Doc, and the run looked up Konan's personal connections instead of his.

The rules are now:

- **Org connections** are usable by every run in the workspace, whoever triggered it.
- **User connections** come from the member behind the run. A run never uses the agent owner's user connections, or any other person's, as a stand-in.
- **GitHub App and Discord installs** are workspace-wide and unchanged.

Executor enforces the first two rules through the session subject. Its storage layer shows a session every `org` row in the tenant plus the `user` rows whose subject matches (`ownerVisibilityCondition` in `@executor-js/sdk` 1.5.40). Garden only mirrors `user` connections into `auth_account` (`apps/web/src/routes/api/oauth/callback.ts`), so `listAvailableConnectorBindings` filters those rows by member and never needs to see org connections.

When an integration has both an org and a user connection, Executor exposes both, under different tool addresses such as `tools.google_drive.org.<name>` and `tools.google_drive.user.<name>`. The agent instructions in `packages/agent-runtime/src/instructions/foundation.md` tell the agent to use the org connection by default. It uses the user connection only when the requester explicitly asks for their own account, such as "my Drive." Org is the default because issue output is shared with the workspace, and the org connection is the account the workspace chose for shared work. Inferring "personal" from looser wording would put a member's private files behind shared output.

Garden decides which member is behind an issue run as follows.

`startIssueRun` in `packages/server/src/issues/run-service.ts` decides the member once, at queue time. `resolveRunConnectorIdentity` in `packages/server/src/issues/run-connector-identity.ts` applies three rules:

- **Triggering member.** A member actor uses their own connections. This covers a comment or mention author, the member who assigned the issue, and the member who started or retried the run.
- **Delegating member.** An agent actor uses the member it was acting for. A chat delegation (`assign_issue` or a status change to `in_progress`) acts for the chat owner. A child issue from `create_child_issue` acts for the parent run's member.
- **No member.** System actors (GitHub webhook, automation triggers) and agent work with no member upstream get no user connections. They still get org connections. When a service has only user connections, the run reports it as unavailable instead of borrowing anyone's account.

The run records its choice as `connectorIdentity` on `issue_run.context_snapshot` and as `connector_identity` on the `issue_run:queued` event, so a person can see which member's accounts a run used. A run that resumes after a question keeps the member it was queued with, even when someone else answers. A run without a recorded identity resolves to no member.

`ThreadRuntimeIdentity.connectorUserId` carries the member into the runtime, and `userId` keeps naming the agent owner. Each consumer reads one of them:

| Consumer                                                        | Reads                                                             | Reason                                                                                                                                                           |
| --------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listAvailableConnectorBindings` (mirrored user `account` rows) | `connectorUserId`                                                 | These are personal accounts. `null` returns workspace installs and keyless connectors only.                                                                      |
| Executor MCP session subject and `buildExecutorMcpServerName`   | `executorSubjectFor`: `connectorUserId`, or `no-member:<agentId>` | The subject selects which user connections are visible; org connections are visible to every subject. The session name is an address, so it follows the subject. |
| Capability sync                                                 | `connectorUserId`                                                 | It lists tools with a member's credentials. A no-member run skips it.                                                                                            |
| `list_workspace_inventory` connectors and Executor catalog      | `connectorUserId` / `executorSubjectFor`                          | It reports what this run can actually reach.                                                                                                                     |
| `loadTeamAgentPolicyForUser`                                    | `userId` (owner)                                                  | Team policy governs the agent, and it can only add approvals.                                                                                                    |
| Brain write credit, logs                                        | `userId` (owner)                                                  | Attribution, not access. Issue runs still read org Brain only.                                                                                                   |

Automation runs still use the agent owner for both fields. Whether an automation should act as its creator is a separate decision.

## Decide takes a direct path

Decide is an Executor integration with its own execution path. `apps/web/src/lib/server/executor-engine/direct-decide-mcp.ts` adds a `directDecideMcp` Executor plugin, and `registerDirectDecideTools` puts the Decide tools on the Executor MCP server.

When a Decide tool runs, the plugin resolves the saved OAuth token inside Executor. Then it calls `https://api.trydecide.ai/mcp` with the official MCP client instead of going through Executor's nested MCP transport. The token stays inside the Worker. `DirectDecideMcpSessionManager` keeps one MCP client per connection, so request ids stay unique across calls. It drops the client after any failed call or disconnect. Analysis calls are not retried, because a retry could bill twice.

The `analyze` tool does not hold the agent's turn open. It starts a durable Decide analysis Workflow (`apps/web/src/decide-analysis-workflow.ts`, ledger table `decide_analysis_run`) through `makeDecideAnalysisStarter`. That Workflow allows up to `DECIDE_ANALYSIS_TIME_LIMIT_MS`, one hour, per analysis. See [Decide](../features/decide.md) for the product side.

Garden uses one Decide path on purpose. Two production paths for the same call would make failures and billing hard to trace.

## Add a connector

To add or change an integration, follow [add a connector](../../guides/develop/add-a-connector.md).
