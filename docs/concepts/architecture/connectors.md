---
title: Connectors run through Executor inside the Garden Worker
description: How Garden installs external integrations, gates their tools, and exposes them to agents through scoped Executor MCP sessions and the direct Decide path.
status: current
owner: '@Flow-Research/security'
last_reviewed: 2026-11-27
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

The native connector registry contains `discord`, `github`, `gmail`, `google-drive`, and `slack`. The curated Executor MCP catalogue also includes Workstream. GitHub and Discord are Garden-native: their tools run through typed Effect services in Garden. The other integrations run through Executor. Executor's `github-rest` and `github-graphql` presets stay disabled, so GitHub runs only through the Garden GitHub App installation (native tools and the Garden-hosted MCP server), never through sandbox HTTP or personal access token presets.

## State lives in three places

Executor stores integration and connection state in the `EXECUTOR_DB` D1 database and blobs in the `EXECUTOR_BLOBS` R2 bucket. Garden's Postgres database stores workspace product state: accounts and installations, capabilities, permission grants, approval requests, and tool-call audit rows. Durable Objects keep agent and MCP session state.

## Every tool has a risk class and a trust level

`packages/connectors/src/sdk.ts` defines four risk classes: `read`, `write`, `send_external`, and `destructive`. An agent's trust level for a tool is `auto`, `allow`, or `ask`. `packages/connectors/src/capabilities.ts` maps a risk class to its default trust and resolves the effective trust for a connection.

Before Garden completes or cancels a connector authorization, it checks the pending connection in Executor. An organization connection requires current connection-management permission. A personal connection must belong to the signed-in member.

An Executor catalog tool that requires approval still needs approval when an agent has an automatic grant. This applies to both seeded and administrator-issued grants. A reused approval must match the run and current Team IDs. An older multi-Team approval that records only Team names needs a new decision.

Unknown tools fail closed. A tool with no risk class defaults to `ask`. Unclassified native or hosted GitHub tools are not exposed at all. Executor receives tenant and member identity from Garden, and it never replaces Garden's workspace authorization checks.

The `capability` table has one row per connector and tool name across all workspaces. Executor lists tools for one workspace and member at a time. Sync adds those tools, but a partial Executor list cannot remove shared rows or lower their stored risk. If two lists give different risks for one name, sync keeps the stricter risk. It seeds grants only for tools in the current list. The Garden native registry defines its full tool list, so native sync can update definitions and remove names that the registry no longer defines.

### Check existing connections and waiting runs before rollout

A run without a member can use an organization tool that already has a correct capability row. It cannot discover a missing capability or record a grant on behalf of an administrator. Before using an existing organization connection, compare its current tools and approval requirements with the stored catalog. If entries are missing or risks are stale, an administrator must resync that connection. Check existing automatic grants if an older sync lowered a risk. Resync cannot restore deleted audit records.

Use this read-only query to identify waiting runs with an old snapshot. It returns run IDs and the recorded actor type. It does not read prompts, credentials or tool output.

```sql
SELECT id, workspace_id, context_snapshot->'actor'->>'type' AS recorded_actor
FROM issue_run
WHERE status = 'waiting_for_input'
  AND NOT (COALESCE(context_snapshot, '{}'::jsonb) ? 'connectorIdentity')
ORDER BY workspace_id, id;
```

If the snapshot records the original member, that member can answer. The run continues without personal connector access. An old agent or system snapshot does not identify a delegating member. Review those runs before cancelling and restarting them. A comment, the current agent owner and an existing tool grant cannot establish the missing identity. This query selects old snapshots only. A malformed identity in a newer snapshot also prevents a resume.

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

Executor enforces the first two rules through the session subject. Its storage layer shows a session every `org` row in the tenant plus the `user` rows whose subject matches (`ownerVisibilityCondition` in `@executor-js/sdk` 1.5.40). Capability sync records tools from both visible owner types, so an org-only connection does not need a personal duplicate. Garden only mirrors `user` connections into `auth_account` (`apps/web/src/routes/api/oauth/callback.ts`), so `listAvailableConnectorBindings` filters those rows by member and never needs to see org connections.

When an integration has both an org and a user connection, Executor exposes both, under different tool addresses such as `tools.google_drive.org.<name>` and `tools.google_drive.user.<name>`. The agent instructions in `packages/agent-runtime/src/instructions/foundation.md` tell the agent to use the org connection by default. It uses the user connection only when the requester explicitly asks for their own account, such as "my Drive." Org is the default because issue output is shared with the workspace, and the org connection is the account the workspace chose for shared work. Inferring "personal" from looser wording would put a member's private files behind shared output.

Garden decides which member is behind an issue run as follows.

`startIssueRun` in `packages/server/src/issues/run-service.ts` decides the member once, at queue time. `resolveRunConnectorIdentity` in `packages/server/src/issues/run-connector-identity.ts` applies three rules:

- **Triggering member.** A member actor uses their own connections. This covers a comment or mention author, the member who assigned the issue, and the member who started or retried the run.
- **Delegating member.** An agent actor uses the member it was acting for. A chat delegation (`assign_issue` or a status change to `in_progress`) acts for the chat owner. A child issue from `create_child_issue` acts for the parent run's member.
- **No member.** System actors (GitHub webhook, automation triggers) and agent work with no member upstream get no user connections. They still get org connections. When a service has only user connections, the run reports it as unavailable instead of borrowing anyone's account.

The run records its choice as `connectorIdentity` on `issue_run.context_snapshot` and as `connector_identity` on the `issue_run:queued` event. This identity stays fixed for the run. A waiting run with personal access resumes only when that same member comments. Another member's comment remains in the issue thread but does not resume that run. Garden returns `already_running` for that start request. A run without a recorded identity gets no personal connections. An older run with a recorded initiating member but no connector identity can resume when that member comments; it still gets no personal connections. Missing or invalid member evidence does not authorize a resume.

`ThreadRuntimeIdentity.connectorUserId` carries the member into the runtime, and `userId` keeps naming the agent owner. Each consumer reads one of them:

| Consumer                                                        | Reads                                                             | Reason                                                                                                                                                           |
| --------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listAvailableConnectorBindings` (mirrored user `account` rows) | `connectorUserId`                                                 | These are personal accounts. `null` returns workspace installs and keyless connectors only.                                                                      |
| Executor MCP session subject and `buildExecutorMcpServerName`   | `executorSubjectFor`: `connectorUserId`, or `no-member:<agentId>` | The subject selects which user connections are visible; org connections are visible to every subject. The session name is an address, so it follows the subject. |
| Capability sync                                                 | `connectorUserId`                                                 | It lists that member's user tools and the workspace's org tools. A no-member run skips sync, but can use org capabilities synced when the connection was set up. |
| `list_workspace_inventory` connectors and Executor catalog      | `connectorUserId` / `executorSubjectFor`                          | It reports what this run can actually reach.                                                                                                                     |
| `loadTeamAgentPolicyForUser`                                    | `userId` (owner)                                                  | Team policy governs the agent, and it can only add approvals.                                                                                                    |
| Brain write credit, logs                                        | `userId` (owner)                                                  | Attribution, not access. Issue runs still read org Brain only.                                                                                                   |

Automation runs still use the agent owner for both fields. Whether an automation should act as its creator is a separate decision.

## Workstream uses a personal Flow Identity authorization

[Workstream](../features/workstream.md) uses the existing Executor remote MCP flow at `https://workstream.flowresearch.tech/mcp`. Garden supplies a deployment-owned public application registration from `WORKSTREAM_MCP_CLIENT_ID`; Executor owns S256 PKCE, callback state, encrypted per-connection credentials, and refresh. Only Personal connections are permitted, while the public app registration is organization-owned. The exact resource, issuer endpoints, and configured client ID bind client reuse. Workstream uses no dynamic client registration.

Garden sign-in is unchanged. The invited Flow Identity account supplies an MCP audience credential. Workstream exchanges it server-side and retains all task and outcome authority. Chat and direct member calls are the first qualification surface. Issue runs use the recorded connector member under the same resume rule as other personal connections. Deployment browser, refresh, and member-isolation proof remains pending in [known gaps](../../reference/known-gaps.md).

## Decide takes a direct path

Decide is an Executor integration with its own execution path. `apps/web/src/lib/server/executor-engine/direct-decide-mcp.ts` adds a `directDecideMcp` Executor plugin, and `registerDirectDecideTools` puts the Decide tools on the Executor MCP server.

When a Decide tool runs, the plugin resolves the saved OAuth token inside Executor. Then it calls `https://api.trydecide.ai/mcp` with the official MCP client instead of going through Executor's nested MCP transport. The token stays inside the Worker. `DirectDecideMcpSessionManager` keeps one MCP client per connection, so request ids stay unique across calls. It drops the client after any failed call or disconnect. Analysis calls are not retried, because a retry could bill twice.

The `analyze` tool does not hold the agent's turn open. It starts a durable Decide analysis Workflow (`apps/web/src/decide-analysis-workflow.ts`, ledger table `decide_analysis_run`) through `makeDecideAnalysisStarter`. That Workflow allows up to `DECIDE_ANALYSIS_TIME_LIMIT_MS`, one hour, per analysis. See [Decide](../features/decide.md) for the product side.

Garden uses one Decide path on purpose. Two production paths for the same call would make failures and billing hard to trace.

## Add a connector

To add or change an integration, follow [add a connector](../../guides/develop/add-a-connector.md).
