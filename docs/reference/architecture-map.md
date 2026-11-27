---
title: Architecture map
description: Code-backed map of Garden's runtimes, bindings, tables, and the files that own each concern.
status: current
owner: "@Umoren"
last_reviewed: 2026-11-03
---

This page lists where each part of Garden lives in the code. For why the parts fit together this way, see [how Garden is built](../concepts/architecture/how-garden-is-built.mdx).

**Stack:** TanStack Start, React, Cloudflare Workers, Durable Objects, and Workflows, Cloudflare Agents with `@cloudflare/think` 0.10.0, Neon Postgres, Drizzle, Better Auth, R2, Cloudflare Sandbox, and Executor 1.5.40.

## Planes

| Plane | Owns | Built on |
| --- | --- | --- |
| Control | Queryable product state: users, workspaces, agents, chat thread metadata, issues, runs, automations, skills, connectors, permissions, documents, and audit | Postgres through Drizzle, and R2 for file bytes |
| Agent | Live conversations and run turns | Durable Objects, the Agents SDK, and Think |
| Execution | Durable runs, codemode, container execution, and connector tools | Workflows, `LOADER`, Cloudflare Sandbox, and Executor MCP sessions |

## Runtimes

| Runtime | Responsibility | Code |
| --- | --- | --- |
| `AgentDO` | Agent identity, access checks, RPC, Workflow creation, and facet routing | `packages/agent-runtime/src/agent-do.ts` |
| `ChatSubAgent` | One Think conversation per chat thread | `packages/agent-runtime/src/agent-do.ts` |
| `IssueRunSubAgent` | Live issue-run turns, issue tools, work products, and source bindings | `packages/agent-runtime/src/issue-run-sub-agent.ts` |
| `AutomationRunSubAgent` | Live automation-run turns | `packages/agent-runtime/src/automation-run-sub-agent.ts` |
| `RunSubAgentBase` | Shared base for issue and automation run facets | `packages/agent-runtime/src/run-sub-agent-base.ts` |
| `BrainAuditSubAgent`, `BrainWriteBackSubAgent` | Brain audit and write-back facets | `packages/agent-runtime/src/brain-audit-sub-agent.ts`, `brain-write-back-sub-agent.ts` |
| `RunWorkflow` | Durable turn, retry, wait, resume, and cancel for issue and automation runs | `packages/agent-runtime/src/run-workflow.ts` |
| `DecideAnalysisWorkflow` | Durable Decide analysis | `apps/web/src/decide-analysis-workflow.ts` |
| `GitHubRepoImportWorkflow` | Imports a linked repository's open GitHub issues onto a Team board | `apps/web/src/github-repo-import-workflow.ts` |
| `AutomationTriggerDO` | Schedule alarms and trigger concurrency | `packages/agent-runtime/src/automation-trigger-do.ts` |
| `WorkspaceRealtimeDO` | Workspace WebSocket hub | `packages/agent-runtime/src/workspace-realtime-do.ts` |
| `ExecutorMcpSession`, `ExecutorMcpExecutionOwnerDirectory` | Executor MCP sessions hosted in the Garden Worker | `apps/web/src/lib/server/executor-engine/mcp.ts`, exported from `apps/web/src/server.ts` |
| `Sandbox` | Cloudflare Sandbox container | `packages/agent-runtime/src/sandbox-tools.ts` |

`apps/web/src/server.ts` exports the runtime classes. It routes `/agents/agent-d-o/:name` through `requireAgentAccess()` and then the Agents SDK `routeAgentRequest`.

## Bindings

`apps/web/wrangler.jsonc` defines these bindings:

| Kind | Bindings |
| --- | --- |
| Durable Objects | `AgentDO`, `Sandbox`, `AUTOMATION_TRIGGER`, `EXECUTOR_MCP_SESSION`, `EXECUTOR_MCP_EXECUTION_OWNER`, `WORKSPACE_REALTIME` |
| Workflows | `RUN_WORKFLOW`, `DECIDE_ANALYSIS_WORKFLOW`, `GITHUB_REPO_IMPORT_WORKFLOW` |
| R2 | `FILES`, `BRAIN_FILES`, `EXECUTOR_BLOBS` |
| D1 | `EXECUTOR_DB` |
| Hyperdrive | `HYPERDRIVE` |
| Worker Loader | `LOADER` |
| Other | `BROWSER`, `AI` |

Executor runs inside this Worker. There is no connector service binding, and no `RUN_QUEUE` binding. The sandbox image is `docker.io/cloudflare/sandbox:0.12.4-python`.

## Durable Object addressing

- `AgentDO` is named by `agent.host_name` or the agent id.
- A chat thread does not get its own `AgentDO`. It opens a `ChatSubAgent` facet named by `chat_thread.runtime_key`.
- Issue run facets are named by issue id. Automation run facets are named by run id.

See [agent runtime](../concepts/architecture/agent-runtime.md).

## Data model

The Drizzle schemas live in `packages/db/src/schema/`:

| Area | File | Main tables or fields |
| --- | --- | --- |
| Agents | `agents.ts` | `agent` with `runtimeConfig`, `permissions`, `adapterType`, `hostName`, and `runTimeoutSec` |
| Agent proposals | `agent-proposals.ts` | Proposed agents |
| Chat | `chat.ts` | `chat_thread` with `agentId`, `runtimeKind`, `runtimeKey`, and `primaryIssueId` |
| Issues | `issues.ts`, `issue-values.ts` | Issues, `issue_run`, run events, source bindings, and work products |
| Automations | `automations.ts`, `automation-values.ts` | `automation`, `automation_trigger`, and `automation_run` |
| Decide | `decide-analysis.ts` | `decide_analysis_run` |
| Capabilities and permissions | `capabilities.ts` | `capability`, `permission_grant`, `connection_grant`, and `permission_request` |
| Audit | `audit.ts` | `invocation_log`, `tool_call_audit`, `activity_event`, and `connector_callback_event` |
| Documents | `documents.ts` | `document` and `document_version` |
| Skills | `skills.ts` | Skills and agent assignments |
| Teams | `teams.ts` | Teams and members |
| Brain | `brain-folders.ts`, `brain-telemetry.ts` | Brain folders and telemetry |
| Integrations | `discord.ts`, `github.ts` | Garden-native installs |
| Workspaces, users, and auth | `workspaces.ts`, `users.ts`, `auth.ts` | Workspaces, users, and Better Auth tables |

Postgres is the authority for queryable state. Think facets keep runtime state in Durable Object SQLite.

## Run start paths

| Run | Start function | Workflow call | Facet |
| --- | --- | --- | --- |
| Issue run | `startIssueRun` in `packages/server/src/issues/run-service.ts` | `AgentDO.startIssueRunWorkflow` | `IssueRunSubAgent(issueId)` |
| Automation run | `startAutomationRun` in `packages/server/src/automations/run-service.ts` | `AgentDO.startAutomationRunWorkflow` | `AutomationRunSubAgent(runId)` |

The Workflow instance id is the run id. See [run engine](../concepts/architecture/run-engine.md).

## Prompt contexts

| Runtime | Contexts | Code |
| --- | --- | --- |
| Chat | `foundation`, `agent`, `workspace`, then skills from `getSkills()` | `ChatSubAgent.configureSession` in `agent-do.ts`, `PostgresAgentPromptCatalog` in `prompt.ts` |
| Issue run | `foundation`, `issue-interaction`, then skills | `RunSubAgentBase.configureSession`, `issue-run-sub-agent.ts` |
| Automation run | `foundation`, `automation-run`, then skills | `RunSubAgentBase.configureSession`, `automation-run-sub-agent.ts` |

The `foundation` text lives in `packages/agent-runtime/src/instructions/`. Skills load from R2 through `loadRuntimeSkillSources` in `packages/agent-runtime/src/skills.ts`.

## Connectors and permissions

| Concern | Code |
| --- | --- |
| Connector manifests | `packages/connectors/src/<id>/connector.ts` for `discord`, `github`, `gmail`, `google-drive`, and `slack` |
| Connector registry | `packages/connectors/src/registry.ts` |
| Risk classes and trust | `packages/connectors/src/sdk.ts`, `packages/connectors/src/capabilities.ts` |
| Executor runtime and MCP host | `apps/web/src/lib/server/executor-runtime.ts`, `apps/web/src/lib/server/executor-engine/mcp.ts` |
| Direct Decide path | `apps/web/src/lib/server/executor-engine/direct-decide-mcp.ts` |
| Runtime MCP controller | `packages/agent-runtime/src/runtime-mcp-controller.ts` |
| Permission derivation | `packages/core/src/agents/permissions.ts` |
| Connections UI | `apps/web/src/features/connections/components/connections-page.tsx` |

Trust levels are `auto`, `allow`, and `ask`. See [connectors](../concepts/architecture/connectors.md).

## Realtime and polling

| Channel | Code |
| --- | --- |
| Chat streaming | `apps/web/src/features/chat/chat-runtime-provider.tsx` |
| Workspace hub connect route `/api/realtime` | `apps/web/src/lib/server/realtime.ts` |
| Workspace hub client | `apps/web/src/lib/realtime/realtime-manager.ts` |
| Issue run polling | `apps/web/src/lib/issues/queries.ts` |
| Inbox polling | `apps/web/src/lib/inbox/queries.ts` |

See [realtime](../concepts/architecture/realtime.md).

## Documents and execution

| Concern | Code |
| --- | --- |
| Document schema | `packages/db/src/schema/documents.ts` |
| Document tools and storage | `packages/agent-runtime/src/documents/` |
| Document routes | `apps/web/src/routes/api/documents/` |
| Document UI | `apps/web/src/features/artifacts/` |
| Codemode `execute` | `createExecuteTool` in `packages/agent-runtime/src/chat-sub-agent-tools.ts` |
| Container sandbox tools | `packages/agent-runtime/src/sandbox-tools.ts` |

Think workspace files and container `/workspace` files are separate stores. See [execution runtimes](../concepts/architecture/execution-runtimes.md).

## HTTP API

| Concern | Code |
| --- | --- |
| Splat route | `apps/web/src/routes/api/$.ts` |
| Combined contract | `apps/web/src/lib/api/garden-api-contract.ts` |
| Server handler | `apps/web/src/lib/server/garden-api.server.ts` |

See [HTTP API](../concepts/architecture/http-api.md).

## Brain

| Concern | Code |
| --- | --- |
| Brain services and Helix client | `packages/brain/src/services/` |
| Scope rules | `packages/brain/src/domain/scope.ts` |
| Brain routes | `apps/web/src/routes/api/brain/` |
| Gateway stack | `compose.brain.yaml` |

See [Brain](../concepts/architecture/brain.md).

## Frontend shell

| Concern | Code |
| --- | --- |
| App shell | `apps/web/src/components/shell/app-shell.tsx` |
| Tabs | `apps/web/src/components/shell/chat-tabs.tsx`, `task-tabs.tsx` |
| Sidebar and top bar | `AppSidebar` and `AppTopBar` from `packages/ui/components/shell/` |
| Authenticated workspace route | `apps/web/src/routes/_authenticated/workspace.tsx` |

Settings opens as a dialog, not a route.

## CI

`.github/workflows/ci.yml` runs verification, including `pnpm verify:connectors`. Known infrastructure gaps are listed in [known gaps](./known-gaps.md).
