---
title: One permission story covers direct tools, codemode, and connectors
description: How agent permissions, capability risk classes, and trust levels decide whether a tool call runs, asks for approval, or is blocked, and the rules that keep approvals out of codemode.
status: current
owner: "@Flow-Research/security"
last_reviewed: 2026-11-10
---

An agent can act through direct tools, through codemode, and through connector tools that Executor serves over MCP. Approval behavior should not depend on which of those paths a call took. Garden is not fully there yet, but every path already reads the same two inputs: the agent's permissions and the capability's trust level.

## Agent permissions decide which tools exist

`AgentPermissionsSchema` in `packages/core/src/agents/permissions.ts` defines what an agent may use:

- `full_access` turns every limit off. It defaults to `true`.
- `allowed_tools` and `allowed_connectors` limit tools when they have entries. An empty list means no limit, because the agent settings UI never writes these lists.
- `allowed_skills` limits skills. Here an empty list means no skills, because the UI fills it.
- `approval_overrides` sets `send_external` and `destructive` approval to `auto` or `manual`.

`evaluateToolPermission` is the single tool gate for chat, issue runs, and automation runs. `derivePermissions` merges an issue's `permissions_override` over the agent's permissions. If stored permissions cannot be parsed, the agent loses full access and every skill. Corrupt settings never grant more than an admin chose.

## Team agent policy is a second ceiling

A Team can cap what any agent does for its members. The runtime loads the policies of every Team the acting user belongs to and combines them strictest-wins. The acting user is the chat owner, or the user who started the issue or automation run.

- **Existence.** A tool exists only when the agent's permissions allow it and no applicable Team blocks its area, its connector, or its risk class. `evaluateRuntimeToolPermission` in `packages/agent-runtime/src/chat-permissions.ts` applies both, so a Team policy never grants a tool the agent lacks.
- **Approval.** A connector call needs approval when trust resolution says `ask` or any applicable Team marks its risk class **Approval required**. A Team rule wins over the agent's `approval_overrides`. The request records `permission_request.team_id`, and that Team's current owner may decide it alongside `permissionManage` holders.

[Teams](./teams.md#agent-policy-caps-what-agents-do-for-a-teams-members) describes the policy shape, the UI, and the approval routing.

## Connector installation requires current workspace authority

GitHub App and Discord bot callbacks verify signed state, then read the current membership of the actor in that state. The actor must still have connection-management permission in the workspace in that state. The callbacks use the same role policy as Garden's organization permission checks. A request header cannot select a different workspace for this check. Garden checks this authority before it calls the provider or writes the installation, callback record, capabilities, or grants.

GitHub keeps its session check outside the development environment. Discord uses verified signed state and does not require a browser cookie. These callbacks do not give authority to an agent or to task content.

## Default-agent recovery requires current creation authority

Workspace creation normally supplies the default Garden agent. Chat listing reads existing records and does not create agents or grants. Chat creation validates a selected issue or agent before it can request default-agent recovery. A selected existing agent does not require a new default.

When the default is missing, only a current workspace member with agent-management permission can repair it. The new default belongs to that authorized person. Members can use an existing default without changing its owner, settings or grants. The same rule applies when Brain file indexing needs a default agent for its audit. If recovery is denied, the indexed file remains, and Garden records the audit failure.

Recovery serializes concurrent attempts for the workspace. It writes the default and its initial grants in one database transaction. A failed grant write rolls back the new agent. Workspace creation uses the same lock and preserves a default that an authorized recovery already created. This repairs a missing default agent; it does not repeat all workspace setup or skill seeding.

## Capabilities carry a risk class and a trust level

Every connector tool is a row in the `capability` table (`packages/db/src/schema/capabilities.ts`). Its `risk_class` is one of `read`, `write`, `send_external`, or `destructive`. `packages/connectors/src/capabilities.ts` holds the shared trust rules. Its `defaultTrustLevelForRisk` gives `read` the default `auto`, `write` the default `allow`, and every other risk class the default `ask`.

Grants attach a trust level to a capability. `permission_grant` and `connection_grant` store `trust_level` as one of three values, enforced by a check constraint:

- `auto` runs silently. It is meant only for safe reads.
- `allow` runs and writes an audit record.
- `ask` creates a `permission_request` and waits for a person to decide.

Older planning documents used `ask_always`, `ask_on_risky`, and `never_ask`. Those names do not exist in the code. A future product setting for connector posture must compile down to per-capability `auto`, `allow`, or `ask` rows.

## The runtime turns trust levels into approvals

`packages/agent-runtime/src/runtime-mcp-controller.ts` wraps each MCP tool with a `needsApproval` check. For a connector call, it looks up the capability's risk class and the grant's trust level. If no grant row exists, it uses the same risk-based default that Executor and the Connectors page use (`defaultTrustLevelForRisk`), so read tools do not raise stale approval cards. Calls routed through Executor are resolved to their connector first and then checked the same way.

An approval surfaces in the chat timeline through `apps/web/src/features/chat/use-tool-approvals.ts` and in the Inbox as a `permission_request`. Approval decisions write `tool_call_audit` rows (`packages/db/src/schema/audit.ts`) through `apps/web/src/lib/server/permission-request.ts`, and the agent and connector activity routes read them. You manage grants on the Connectors page, `apps/web/src/features/connections/components/connections-page.tsx`.

## Codemode and the container sandbox are separate surfaces

Garden has two ways to run code. They do not share files.

| Surface                 | Runtime                                                                 | Best for                                                                       | Storage                      |
| ----------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------- |
| Codemode `execute`      | `@cloudflare/codemode` in a Dynamic Worker through the `LOADER` binding | Bounded JavaScript that plans several file or tool steps                       | The Think workspace          |
| Container sandbox tools | `@cloudflare/sandbox` through the `Sandbox` binding                     | Shell, native binaries, package installs, previews, and long-running processes | The container's `/workspace` |

`createExecuteTool` builds the codemode tool in `packages/agent-runtime/src/chat-sub-agent-tools.ts` and `automation-run-sub-agent.ts`. The sandbox tools live in `packages/agent-runtime/src/sandbox-tools.ts`. The [execution runtimes](../architecture/execution-runtimes.md) page explains both.

Codemode matters for permissions because its inner tool calls are not outer model tool calls. AI SDK `needsApproval` never sees them, so a tool that may pause for approval must not be reachable only from inside codemode.

## The target is one policy module at the Executor boundary

The intended shape has five parts:

1. Every callable tool, local or MCP, has a risk class.
2. One shared policy module makes the decision for the runtime, Executor dispatch, UI inspection, and tests.
3. Enforcement stays at the Executor dispatch boundary, because Executor holds the upstream tokens.
4. Each execution surface exposes only tools whose effective policy is safe for it.
5. Every tool call is audited, including calls made inside codemode.

Open policy gaps are tracked in [known gaps](../../reference/known-gaps.md).

## Issue tools see the workspace as the chat owner does

A chat agent's issue tools act for the person who owns the chat. `list_issues`, `read_issue`, `post_issue_comment`, `assign_issue`, and `update_issue_status` apply the Team issue rule to that person, so the agent reaches workspace issues and the boards of Teams the owner belongs to, and every Team issue when the owner is a workspace owner or admin. A Team issue outside the owner's reach returns `Issue not found.`, so the agent cannot confirm that it exists. `issueVisibilityFor` in `packages/server/src/issues/server.ts` reads the owner's workspace role and builds `teamIssueVisibilityCondition`; `listIssues`, `readIssue`, and `resolveVisibleIssue` apply it. See [Teams](teams.md#team-members-work-the-whole-team-board) for the rule. `read_run` does not apply it yet. [Known gaps](../../reference/known-gaps.md) tracks that.

## Rules for permission changes

- Keep the schema and runtime names `auto`, `allow`, and `ask`.
- Never let a destructive tool run silently unless the code proves a safe exception.
- Do not hide approval-required behavior inside codemode. Expose actions that may pause for approval as direct outer tools.
- Keep connector token injection inside Executor. Agent Durable Objects never see upstream tokens.
- Use `better-result` for new TypeScript error handling.
