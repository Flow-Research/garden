---
title: Team agent policy
description: Proposal to let workspace admins cap what agents may do when they act for a Team's members, which connectors they may use, and which actions need the Team owner's approval.
status: proposal
owner: '@Umoren'
last_reviewed: 2026-11-05
---

**Date:** 2026-11-05. **Audience:** product, frontend, backend, and QA engineers.

> **Not built.** As of 2026-11-05, Teams play no part in agent permission or approval decisions. This proposal follows the Teams Settings entry (PR #288), and covers screens 34 to 38 of the Teams admin designs.

## The problem

Fred owns the Technical Team. Vera is on his Team. She asks the workspace agent to email a client the status of a deploy. Today the agent sends that email under the workspace's rules alone. Fred cannot say "on my Team, external email waits for me," and the workspace admin cannot say "Finance agents never touch GitHub." The only levers are per-agent settings, and every member shares one agent.

The question this proposal answers: **when an agent acts for a member of a Team, what can that Team's policy remove, and who approves what it holds back?**

## Decisions

These were settled on 2026-11-05.

| Decision                        | Choice                                           | Why                                                                                                                                                                                                                               |
| ------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which agent a policy applies to | Any agent acting for a Team member               | Garden has one shared default agent per workspace, not a personal agent per member. The acting user, the owner of the chat or the user who started the run, is what identifies "Vera's work."                                     |
| How rules combine               | Strictest wins                                   | A Team policy is a ceiling. It can remove abilities and add approvals, never grant more than the agent already has. A person on two Teams gets the stricter of both.                                                              |
| Who approves                    | The Team owner, plus workspace owners and admins | The design's "Default approver: Department Head" is the Team owner. Admins keep their existing right to approve anything.                                                                                                         |
| Admin Policy tab                | Cut                                              | Retention, external sharing, organization policy, and autonomous-action levels have no backing in Garden. Audit logging is always on and must not become a per-Team switch. Those belong to a separate workspace policy proposal. |

Personal agents are out of scope. If Garden later gives each member an agent, this policy still applies, because it keys on the acting user, not the agent.

## What the admin sets

The Team settings panel has three tabs. Each maps to an existing permission concept.

### Agent access

Admins choose which areas an agent may use for this Team's members. The areas are groups of agent tools:

| Area        | Agent tools it covers                   |
| ----------- | --------------------------------------- |
| Tasks       | Issue tools                             |
| Knowledge   | Brain tools                             |
| Inbox       | Inbox tools                             |
| Connections | Connector tools served through Executor |
| Workflows   | Automation tools                        |
| Skills      | Skills                                  |

The design also lists **Chats** and **Home**. They are dropped: the agent lives in chat, and Home is a page with no agent tools.

Below the areas, **Restricted** blocks whole risk classes. The design's examples, "Delete projects," "Manage billing," and "Read locked files," have no matching capabilities in Garden. They are replaced by the two classes Garden already labels: **Destructive actions** and **Sending outside the workspace** (`destructive` and `send_external` in `capability.risk_class`).

The design's per-member **Team Role** select is dropped. Team roles beyond the owner are out of scope for Teams today.

### Connector access

A list of the workspace's connectors with a switch each. A switched-off connector is unavailable to agents acting for this Team's members. All connectors are on for a new policy, so creating one changes nothing until an admin switches something off.

### Approval rules

One row per risk class: **Write**, **Sending outside the workspace**, and **Destructive**. Each is either **Follow agent settings** or **Approval required**. There is no "Auto-approved" option, because a Team can only add approvals. The approver row is fixed text: "The Team owner, or any workspace admin."

The design's rows for "Deploy changes," "Create documents," and "Audit logging" are not risk classes. Deploys and documents fall under their capability's risk class. Audit logging is not an approvable action.

## How a decision is made

The agent runtime already decides each tool call in two places:

1. **Does the tool exist?** `isChatToolAllowed` in `packages/agent-runtime/src/chat-permissions.ts` reads `agent.permissions` (`allowed_tools`, `allowed_connectors`, `allowed_skills`).
2. **Does it need approval?** `ensureConnectorToolNeedsApproval` in `packages/agent-runtime/src/runtime-mcp-controller.ts` resolves trust with `resolveEffectiveTrust`: tool grant, then connection grant, then the risk-class default.

Team policy adds one input to each, for the acting user's Teams:

- **Existence.** A tool exists only if the agent's permissions allow it **and** every applicable Team policy allows its area, its connector, and its risk class.
- **Approval.** A tool needs approval if trust resolution says `ask` **or** any applicable Team policy marks its risk class **Approval required**.

"Applicable" means every Team whose `team_member` rows include the acting user. A user on no Team is unaffected. A Team policy never changes another Team's members.

The acting user comes from `resolveThreadRuntimeIdentity` for chat and from `host.resolveRuntimeIdentity` for issue and automation runs. Both already exist and already drive connector bindings.

### Codemode

Inner codemode calls never reach `needsApproval`. The permissions page already requires that a tool which may pause for approval is an outer tool. Team policy follows the same rule:

- Area and connector limits apply inside codemode, because codemode only sees tools that exist.
- A risk class a Team marks **Approval required** is removed from codemode for that user. Those tools stay available as outer tools, where the approval can pause the run.

## Who approves

An approval held back by Team policy creates a `permission_request` as today, with a new nullable `team_id` naming the Team whose rule required it. When several Teams require it, the request names the first by Team name and lists the rest in `context`.

- The Team owner gets the Inbox item. Today `workspacePermissionApproverIds` in `packages/db/src/inbox.ts` routes requests to workspace owners and admins only.
- The approval route accepts the decision from the request's Team owner, or from anyone with `workspacePermissions.permissionManage`, as today. A Team owner cannot approve requests for another Team.
- When ownership transfers, open requests follow the new owner. The check reads `team.owner_user_id` when the decision arrives, not when the request was made.

## Data model

One row per Team, typed by one shared schema. Edit the Drizzle schema first, then run `pnpm --filter @garden/db db:generate`.

```ts
// packages/core/src/teams/agent-policy.ts
export const TeamAgentAreaSchema = z.enum([
  'tasks',
  'knowledge',
  'inbox',
  'connections',
  'workflows',
  'skills',
])
export const RiskClassSchema = z.enum(['write', 'send_external', 'destructive'])

export const TeamAgentPolicySchema = z.object({
  allowed_areas: z.array(TeamAgentAreaSchema),
  blocked_risk_classes: z.array(RiskClassSchema.exclude(['write'])),
  blocked_connector_ids: z.array(z.string()),
  approval_required: z.array(RiskClassSchema),
})
```

```text
team_agent_policy
  team_id        uuid primary key, composite FK (team_id, workspace_id) → team, on delete cascade
  workspace_id   text not null
  policy         jsonb not null, validated by TeamAgentPolicySchema at every write and read
  updated_by     text not null → user
  updated_at     timestamptz not null
```

No row means no policy. Connectors are stored as a blocklist so a connector added later is allowed until an admin blocks it, matching "all on" in the UI.

`permission_request` gains `team_id`, nullable, with a composite FK to `team`.

## API

| Method | Endpoint                          | Who                                   | Behavior                                                                                          |
| ------ | --------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/teams/:teamId/agent-policy` | Workspace managers and the Team owner | The policy, or the default "no limits" policy when no row exists                                  |
| `PUT`  | `/api/teams/:teamId/agent-policy` | Workspace managers only               | Replace the policy. Validates with `TeamAgentPolicySchema`. Returns `{ error, code }` on failure. |

A Team owner can read the policy but not change it. The Team owner is the person it constrains approvals around, so an admin sets it.

A write publishes `team:policy_updated` with workspace and Team IDs only, like the other Team events. The runtime does not cache policies across turns, so the next tool decision reads the new policy.

## UI

Design elements with no backing in Garden still render, disabled, with a **Coming soon** badge: the Chats and Home areas, the Delete projects, Manage billing, and Read locked files restrictions, the Deploy changes and Create documents approval rows, the per-member Team Role select, and the Admin Policy tab. They store nothing and the API rejects them, so the badge is the only thing they do.

- The Team detail page's overflow menu gains **Agent policy** for workspace managers and the Team owner. It opens the panel as a side sheet with **Agent access**, **Connector access**, and **Approval rules** tabs, and **Cancel** and **Save changes**.
- The Team owner sees the same panel read-only, with a line saying only workspace admins can change it.
- The per-row **Agent settings** button in the design is dropped. The policy is per Team, not per member, so one entry point is enough.
- When a user's agent loses a tool to Team policy, the agent's tool list omits it. When a call waits on a Team rule, the approval card names the Team: "Waiting for Fred (Technical Team owner)."

## Testing

- **Policy schema:** every write rejects unknown areas, risk classes, and extra keys.
- **Combination:** a user on two Teams gets the union of blocks and approvals; a user on no Team is unaffected; a Team policy never grants a tool the agent lacks.
- **Runtime:** a blocked area's tools are absent from the tool list; a blocked connector's tools are absent; an approval-required class pauses an outer call and is absent from codemode.
- **Approvals:** the Team owner sees and resolves the request; another Team's owner gets 403; an admin still resolves it; after an ownership transfer the new owner resolves it.
- **API:** a Team owner gets the policy and is refused a write; a member gets 403 on read; the realtime payload carries IDs only.

## Out of scope

- Personal agents per member.
- Workspace-wide policy: data retention, external sharing, organization policy, autonomous-action levels. A separate proposal should own these.
- Team roles beyond the owner.
- New capabilities for billing or locked files.

## Open questions

- **Area tagging.** No agent tool declares an area today. Each tool registry entry needs an `area` field, and tools with no area need a decision: always allowed, or only allowed with no policy. The proposal assumes "always allowed."
- **Issue runs for a Team.** An issue assigned to a Team but started by someone outside it runs under the starter's Teams, not the issue's Team. Should the issue's Team policy also apply?
