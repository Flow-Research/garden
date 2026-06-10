# Garden — Product Requirements Document

**Status:** living product spec, code-aligned
**Last reviewed:** 2026-05-24

> Raise the floor, don't lower the ceiling.

## 1. Executive summary

Garden is a company operating surface where humans and AI agents work side by side. The product combines chat, work tracking, automations, skills, connectors, documents, and approvals in one workspace.

The core implementation is data-driven agents on Cloudflare:

- Postgres stores agents, workspaces, chats, issues, automations, skills, connectors, permissions, documents, and audit.
- `AgentDO` is the generic runtime parent for an agent identity.
- `ChatSubAgent`, `IssueRunSubAgent`, and `AutomationRunSubAgent` are Think child facets for specific contexts.
- `RunWorkflow` owns durable long-running execution for issue and automation runs.

Code map: `packages/db/src/schema`, `packages/agent-runtime/src`, `apps/web/src/components/shell`, `apps/web/src/features`.

## 2. Product positioning

Garden is not a standalone chatbot. It is an operating layer for work moving between people, agents, tools, and approvals.

Primary users:

- founders/CEOs coordinating cross-functional work;
- ops/finance/marketing/sales/support teams doing knowledge work through connected SaaS tools;
- developers who want agent-authored or agent-coordinated work to return to a shared issue/work surface.

Not first:

- solo prompt playgrounds;
- big-enterprise-only deployments;
- dev-only IDE/terminal agent replacement.

## 3. Operating principles

1. **Don't limit anyone's upside.** Non-technical users get rails, but advanced capability remains reachable.
2. **One person's breakthrough becomes everyone's baseline.** Skills, connector permissions, agent configs, and reusable patterns compound at workspace scope.
3. **The product is the enablement.** Onboarding, approvals, tool errors, and agent output should teach by doing instead of requiring training.

## 4. Current product surface

Garden uses one authenticated workspace shell with a left rail, context explorer, and Dockview panel area.

Code evidence:

- `apps/web/src/components/shell/workspace-layout.tsx`
- `apps/web/src/components/shell/sidebar.tsx`
- `apps/web/src/components/shell/workspace-dock.tsx`

Current rail contexts:

- Home
- Chats
- Tasks
- Automations
- Inbox
- Agents
- Skills
- Connections

Settings is currently a dialog (`apps/web/src/features/settings`) rather than a primary rail panel.

## 5. Primary entities

| Primitive | Source of truth | Runtime/UI notes |
| --- | --- | --- |
| Workspace/company | Postgres `organization` / membership tables | Tenancy boundary. |
| User/member | Better Auth + Postgres | Authenticated actor. |
| Agent | Postgres `agent` + `AgentDO` | Data-driven persona/config/permissions; runtime identity via `hostName`/id. |
| Chat thread | Postgres `chat_thread` + `ChatSubAgent` | Metadata in Postgres; Think messages in child facet. |
| Issue/task | Postgres `issue` | Assignable to user or agent. |
| Issue run | Postgres `issue_run` + `IssueRunSubAgent` + `RunWorkflow` | Durable issue work ledger. |
| Automation | Postgres `automation` / `automation_trigger` | Top-level scheduled/manual/webhook/API work surface. |
| Automation run | Postgres `automation_run` + `AutomationRunSubAgent` + `RunWorkflow` | Durable automation execution ledger. |
| Skill | Postgres catalog/assignments + R2 SKILL.md bundles + Think skill sources | Workspace-scoped, assignable to agents. |
| Connector/capability | Connector registry + Postgres capability/grant tables + MCP proxy | Tools exposed with `auto | allow | ask` trust levels. |
| Document artifact | Postgres document tables + R2/Shell workspace | Thread-scoped artifacts with versions/edits. |
| Inbox item | Computed server surface + dismissal records | Approvals, mentions, blockers, failures. |

## 6. MVP/current scope

In or underway:

1. Workspace/auth shell with onboarding scaffolding.
2. Data-driven agents, not hard-coded one-class personas.
3. Chat threads tied to specific agents.
4. Issue/task board and issue detail surface.
5. Agent issue runs with Workflow-backed execution.
6. Automations as a separate top-level surface and run ledger.
7. Workspace skills library and runtime skill loading.
8. Connectors/capabilities with per-agent grants.
9. Inbox/approval surfaces.
10. Document artifacts: upload, generate, preview, edit, accept/reject, citation highlighting.
11. Codemode and Cloudflare Sandbox execution paths.
12. Dockview panel workspace.

Out of current scope / deferred:

- workspace-wide realtime bus;
- shared cross-chat memory synthesis;
- cross-workspace skill marketplace;
- enterprise SSO/RBAC/on-prem;
- full visual runtime/chart/rendering subsystem;
- workspace-level document artifact tabs;
- Zapier-scale connector catalog.

See `docs/core/DEFERRED.md` and `docs/known-gaps`.

## 7. Permissions and trust model

Runtime/schema terms are:

- `auto` — only valid for safe read-style flows; proceed silently;
- `allow` — proceed and audit;
- `ask` — create/resolve a permission request before continuing.

Code evidence:

- `packages/db/src/schema/capabilities.ts`
- `packages/core/agents/permissions.ts`
- `workers/mcp-proxy/src/permission.ts`
- `packages/agent-runtime/src/runtime-mcp-controller.ts`
- `apps/web/src/features/connections/components/connections-page.tsx`

Do not use old planning terms (`ask_always`, `ask_on_risky`, `never_ask`) for current code.

## 8. Runtime architecture requirements

- Keep `AgentDO` as the parent runtime identity.
- Keep chat as `ChatSubAgent(threadId)` facets.
- Keep issue runs and automation runs separate product ledgers.
- Keep `RunWorkflow` as the durable retry/wait/resume/cancel boundary.
- Do not add issue-backed automation compatibility.
- Do not add queue dispatch between `AgentDO` and `RunWorkflow`.
- Do not switch live chats by mutating Think `this.session`.

Code evidence: `docs/core/technical.md`, `docs/core/chat-runtime-model.md`, `docs/features/agent-runtime-rearchitecture.md`.

## 9. Success criteria

Product success still means a user can:

- create/join a workspace;
- talk to an agent in a persistent chat;
- connect tools and see capability permissions;
- create or receive work items;
- assign work to an agent and observe progress/result;
- approve or deny risky actions;
- create/use skills;
- run automations without polluting the issue board.

Engineering success means docs and code agree. Any future architecture doc should include code evidence paths like this one.

## 10. Open questions

- Pricing and packaging.
- Default trust posture and upgrade nudges.
- Which connector/work-entry paths matter most at launch.
- How much shared memory should be parent-backed vs thread-scoped.
- How/when to add workspace-wide realtime fanout.
- How to expose document artifacts as workspace-level tabs.

## References

- Current technical architecture: `docs/core/technical.md`
- Chat runtime model: `docs/core/chat-runtime-model.md`
- Agent runtime rearchitecture: `docs/features/agent-runtime-rearchitecture.md`
- Known gaps: `docs/known-gaps/`
- Current code: `packages/agent-runtime/src`, `packages/db/src/schema`, `apps/web/src/features`
