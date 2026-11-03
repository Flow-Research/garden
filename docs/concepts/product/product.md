---
title: Garden is a workspace where people and agents share the work
description: What Garden is for, who it serves, which product primitives it is built from, and the rules that keep the product coherent.
status: current
owner: "@Umoren"
last_reviewed: 2026-11-03
---

> Raise the floor, don't lower the ceiling.

## Garden is an operating surface, not a chatbot

Garden is a company workspace where humans and AI agents work side by side. One workspace holds chat, work tracking, automations, skills, connectors, documents, and approvals. Work moves between people, agents, tools, and approvals without leaving that workspace.

The agents are data, not code. Postgres stores each agent's persona, configuration, and permissions. `AgentDO` is the runtime parent for one agent identity. Each context the agent works in gets its own Think child facet: `ChatSubAgent` for a chat thread, `IssueRunSubAgent` for issue work, and `AutomationRunSubAgent` for an automation run. `RunWorkflow` owns long-running issue and automation runs. To find the code behind each part, see the [architecture map](../../reference/architecture-map.md).

## Garden serves teams doing knowledge work through tools

Garden is built first for these users:

- Founders and CEOs who coordinate work across functions.
- Operations, finance, marketing, sales, and support teams who do knowledge work through connected SaaS tools.
- Developers who want work done or coordinated by agents to return to a shared issue surface.

Garden does not target these uses first:

- Solo prompt playgrounds.
- Deployments that only make sense for large enterprises.
- A replacement for terminal coding agents or IDE copilots.

## Three principles decide product trade-offs

1. **Don't limit anyone's upside.** Non-technical users get rails. Advanced capability stays reachable.
2. **One person's breakthrough becomes everyone's baseline.** Skills, connector permissions, agent configs, and reusable patterns compound at workspace scope.
3. **The product is the enablement.** Onboarding, approvals, tool errors, and agent output teach by doing. Users do not need separate training.

## The workspace shell is a sidebar and routed pages

You work in one authenticated shell, `AppShell` in `apps/web/src/components/shell/app-shell.tsx`. It has a labeled sidebar, a top bar, and a content pane where each surface renders as a route. The sidebar items come from `NAV_ITEMS` in `apps/web/src/features/navigation/nav-items.tsx`:

- Home (`/home`)
- Chats (`/chats`)
- Tasks (`/tasks`)
- Files & Folders (`/files`)
- Inbox (`/inbox`)
- Workflows (`/workflows`), the automations surface
- Agents (`/agents`)
- Skills (`/skills`)
- Connectors (`/connectors`)
- Teams (`/teams`), with an admin-only Issues child at `/teams/issues`

Settings opens as a dialog from `apps/web/src/features/settings`. It is not a sidebar page.

## Each product primitive has one source of truth

The table names where each primitive lives and how it runs.

| Primitive | Source of truth | Runtime notes |
| --- | --- | --- |
| Workspace | Postgres `organization` and membership tables | The tenancy boundary. |
| User | Better Auth and Postgres | The authenticated actor. |
| Agent | Postgres `agent` and `AgentDO` | Data-driven persona, config, and permissions. |
| Chat thread | Postgres `chat_thread` and `ChatSubAgent` | Metadata in Postgres. Think messages live in the child facet. |
| Issue | Postgres `issue` | Assignable to a user or an agent. Shown as Tasks in the UI. |
| Issue run | Postgres `issue_run`, `IssueRunSubAgent`, and `RunWorkflow` | The durable ledger of issue work. |
| Automation | Postgres `automation` and `automation_trigger` | Scheduled, manual, webhook, or API work. |
| Automation run | Postgres `automation_run`, `AutomationRunSubAgent`, and `RunWorkflow` | The durable ledger of automation work. |
| Skill | Postgres `skill`, `skill_version`, `skill_file`, and `skill_assignment`, plus `SKILL.md` bundles in R2 | Workspace-scoped and assigned to agents. |
| Connector capability | Executor and the Postgres `capability`, `permission_grant`, and `connection_grant` tables | Each tool carries an `auto`, `allow`, or `ask` trust level. |
| Document artifact | Postgres `document` and `document_version`, bytes in R2 | Thread-scoped documents with versions. |
| Inbox item | Computed by `apps/web/src/lib/server/inbox-compute.ts`, with `inbox_dismissal` records | Approvals, mentions, blockers, and failures. |

## The current scope covers the full work loop

These surfaces exist in the product today:

1. Workspace sign-in, the app shell, and onboarding.
2. Data-driven agents.
3. Chat threads tied to specific agents.
4. The issue board and issue detail page.
5. Agent issue runs backed by `RunWorkflow`.
6. Automations as their own surface and run ledger.
7. A workspace skill library and on-demand skill loading at runtime.
8. Connectors with per-agent capability grants.
9. The Inbox and approval surfaces.
10. Document artifacts: upload, generate, preview, edit, and accept or reject changes.
11. Codemode and Cloudflare Sandbox execution.
12. Teams with Team-scoped issues.
13. The workspace realtime hub (`WorkspaceRealtimeDO`), which tells clients when to refetch.

Work that is deferred or out of scope is in the [roadmap](./roadmap.md). Open defects are in [known gaps](../../reference/known-gaps.md).

## Trust levels are `auto`, `allow`, and `ask`

Every capability grant uses one of three trust levels. The `capability`, `permission_grant`, and `connection_grant` tables in `packages/db/src/schema/capabilities.ts` enforce them with a check constraint.

- `auto` proceeds silently. It is meant only for safe read flows.
- `allow` proceeds and writes an audit record.
- `ask` creates a `permission_request` and waits for a decision before it continues.

Older planning documents used `ask_always`, `ask_on_risky`, and `never_ask`. Those names do not exist in the code. For how the policy is enforced, see [permissions](../features/permissions.md).

## Runtime rules keep the product model intact

These rules protect the shape of the runtime. Breaking one tends to blur two product surfaces together.

- `AgentDO` stays the parent runtime identity.
- Each chat stays a `ChatSubAgent` facet named by the thread's `runtime_key`.
- Issue runs and automation runs stay separate product ledgers.
- `RunWorkflow` stays the durable boundary for retry, wait, resume, and cancel.
- Automations never create issues as their orchestration path.
- No queue sits between `AgentDO` and `RunWorkflow`.
- A live chat never switches by mutating Think's `this.session`.

The [run engine](../architecture/run-engine.md) and [agent runtime](../architecture/agent-runtime.md) pages explain why.

## Success means a tester can finish the whole loop

Product success means a user can do all of these:

- Create or join a workspace.
- Talk to an agent in a persistent chat.
- Connect tools and see each capability's permission.
- Create or receive work items.
- Assign work to an agent and watch its progress and result.
- Approve or deny risky actions.
- Create and use skills.
- Run automations without adding cards to the issue board.

Engineering success means the docs and the code agree. Every architecture page cites the code paths that back its claims.

## Questions the product has not settled

- Pricing and packaging.
- The default trust posture for new connector grants, and when to nudge users to raise it.
- Which connectors and work-entry paths matter most at launch.
- How much shared memory belongs to the parent agent and how much stays scoped to a thread.
- How to show document artifacts as workspace-level tabs.
