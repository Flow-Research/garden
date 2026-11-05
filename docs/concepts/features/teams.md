---
title: Teams group people and agents, and scope who sees which issues
description: How Teams work in a workspace, who can manage them, how admins reach them from Settings, how a Team agent policy caps agents, and why Team realtime events carry identifiers only.
status: current
owner: "@Umoren"
last_reviewed: 2026-11-05
---

A Team is a group inside a workspace, such as Engineering or Finance. It holds people and agents, has one human owner, and can own issues. Teams decide who sees which Team issues, so they are both an organizing tool and an access rule.

## Roles decide what each person can do

Three roles meet on a Team. The server enforces each rule; the UI only hides controls a person cannot use.

| Who | Sees | Can change |
| --- | --- | --- |
| Workspace owner or admin | Every Team and every Team issue | Create, edit, and delete any Team, manage members, and transfer ownership |
| Team owner | Their Team and all of its issues | Edit their Team and manage its members. They cannot transfer ownership or delete the Team. |
| Team member | Only the Teams they belong to, and only the Team issues assigned to them | Nothing on the Team itself |

A Team has exactly one human owner. An agent can be a member but never the owner. A Team with issues cannot be deleted; the API returns `TEAM_HAS_ISSUES`.

The `can_manage` and `can_transfer_owner` fields in a Team response are rendering hints. `requireTeamAccess`, `requireTeamManage`, and `requireTeamOwnerTransfer` in `apps/web/src/lib/server/team-access.ts` make the actual decision on every request.

## Teams live at `/teams`

Teams has one home in the app:

| Route | What it shows |
| --- | --- |
| `/teams` | Owners and admins see summary cards and a grid of Team cards with create, edit, delete, and ownership actions. Members see a Team selector and their Team's issues. |
| `/teams/$teamId` | Team detail with **Members** and **Issues** tabs. The tab is URL state (`?tab=members` or `?tab=issues`), and an unknown value falls back to Members. |
| `/teams/issues` | Issues across every Team, for owners and admins |

The sidebar links to `/teams`. Settings links to it too.

## Settings opens the Teams page

Workspace owners and admins see a **Teams** entry under the workspace section of Settings. It is not a Settings tab. Clicking it closes Settings, then navigates to `/teams`, so the Teams page never mounts under the open modal. Members do not see the entry, and it stays hidden while the member list loads.

The entry exists so admins who look for Team management in Settings find it. Settings does not copy the Teams pages, and there is no Settings-specific Teams API. `TeamsSettingsLink` in `apps/web/src/features/settings/components/settings-page.tsx` implements it.

Settings remembers its selected tab. `useSettingsDialogStore` keeps `activeTab` while the dialog is closed, so reopening Settings returns to the last tab. `openSettings('members')` still deep-links to a tab.

## The client caches one Team list shape

`GET /api/teams` returns `{ teams, total, unique_member_count }`. `teamListOptions` in `apps/web/src/features/teams/queries.ts` caches that whole response, and each caller reads `.teams` itself. The overview needs `unique_member_count` for its member card, which counts a person on two Teams once.

Team query keys are scoped by workspace: `['teams', workspaceId, 'list']`, `['teams', workspaceId, 'detail', teamId]`, `['teams', workspaceId, 'members', teamId]`, and `['issues', workspaceId, 'team', teamId]`. Queries keep the previous data while they refetch, so navigation and mutations do not flash an empty state.

## The API is the contract

| Method | Endpoint | Behavior |
| --- | --- | --- |
| `GET` | `/api/teams` | Visible Teams, total, and distinct visible member count |
| `POST` | `/api/teams` | Create a Team and optional initial members in one transaction |
| `GET` | `/api/teams/:teamId` | Caller-relative Team detail and counts |
| `PATCH` | `/api/teams/:teamId` | Update name or description |
| `DELETE` | `/api/teams/:teamId` | Delete a Team with no issues. Owners and admins only. |
| `GET` | `/api/teams/:teamId/members` | Member rows for users and agents |
| `POST` | `/api/teams/:teamId/members` | Add one user or agent from the same workspace |
| `DELETE` | `/api/teams/:teamId/members/:membershipId` | Remove a member. The owner cannot be removed. |
| `PUT` | `/api/teams/:teamId/owner` | Transfer ownership to a human member. Owners and admins only. |
| `GET`, `PUT` | `/api/teams/:teamId/agent-policy` | Read or replace the Team agent policy. See [Agent policy](#agent-policy-caps-what-agents-do-for-a-teams-members). |

Request bodies use the Zod schemas in `apps/web/src/lib/server/validation/teams.ts`. Errors use the `{ error, code }` envelope. The tables are `team` and `team_member` in `packages/db/src/schema/teams.ts`, and `issue.team_id` links an issue to its Team.

## Realtime events say what changed, not what it looks like

After a successful write, the route publishes a workspace event: `team:created`, `team:updated`, `team:deleted`, `team_member:added`, `team_member:removed`, or `team:policy_updated`. A refused write publishes nothing.

The payloads carry identifiers only: workspace, Team, membership, member type, and the user or agent ID, plus `owner_user_id` on created and updated events. Every Team member's socket receives these events, so a Team DTO would leak the publisher's `can_manage` flag and the counts they can see. `team:deleted` no longer carries the Team name for the same reason. Clients invalidate the `teams` cache and refetch. The realtime hub reads `owner_user_id` to keep each socket's list of owned Teams current after a transfer. See [Realtime](../architecture/realtime.md).

## Agent policy caps what agents do for a Team's members

Garden has one shared agent per workspace, so a Team cannot have its own agent. Instead, a Team can carry an agent policy. It applies whenever any agent acts for one of the Team's members: the owner of the chat, or the user who started the issue or automation run. A user on no Team is unaffected.

A policy is a ceiling. It can switch tools off and add approvals. It never grants a tool the agent's own permissions lack. A person on two Teams gets the stricter rule from each, so blocks and approvals are unions.

| Tab | What the admin sets | Stored as |
| --- | --- | --- |
| Agent access | Which areas agents may use: Tasks, Knowledge, Inbox, Connections, Workflows, Skills. Below them, **Restricted** blocks the Destructive and Sending outside the workspace risk classes. | `allowed_areas`, `blocked_risk_classes` |
| Connector access | A switch per connector. All are on until an admin turns one off. | `blocked_connector_ids` (a blocklist, so a new connector starts allowed) |
| Approval rules | Write, Sending outside the workspace, and Destructive are each **Follow agent settings** or **Approval required**. The approver is the Team owner or any workspace admin. | `approval_required` |

`TeamAgentPolicySchema` in `packages/core/src/teams/agent-policy.ts` is the one shape for the API, the database, and the runtime. It is strict, so an unknown key or value fails validation. The `team_agent_policy` table holds one row per Team. No row means no limits.

### Who can see and change it

| Who | Can |
| --- | --- |
| Workspace owner or admin | Read and change the policy |
| Team owner | Read it. The panel is read-only and says only workspace admins can change it. |
| Team member | Nothing. `GET` returns 403. |

The Team detail page's actions menu has **Agent policy** for workspace managers and the Team owner. It opens a side sheet with the three tabs, **Cancel**, and **Save changes**. Saving updates the cached policy at once and rolls it back if the server refuses. `TeamAgentPolicySheet` in `apps/web/src/features/teams/components/team-agent-policy-sheet.tsx` implements it.

Design controls with no backing in Garden still render, disabled, with a **Coming soon** badge: the Chats and Home areas; the Delete projects, Manage billing, and Read locked files restrictions; the Deploy changes and Create documents approval rows; the per-member Team role control; and the Admin Policy tab. They store nothing, and the schema rejects them if a client sends them.

### How the runtime applies it

`loadTeamAgentPolicyForUser` in `packages/core/src/teams/agent-policy-store.ts` reads every policy for the acting user's Teams and folds them with `combineTeamAgentPolicies`. The runtime reads it every turn and on every approval decision, so a saved policy applies to the next decision. A stored row that fails the schema counts as the strictest policy.

- **Tool existence.** `evaluateRuntimeToolPermission` in `packages/agent-runtime/src/chat-permissions.ts` checks the Team ceiling first, then the agent's permissions. A blocked tool is left out of the chat or run tool list and refused if called. Each native tool's area comes from `AGENT_TOOL_AREAS` in the same file. Connector and Executor tools are in Connections, and a connector tool's risk class comes from the connector registry. A tool with no area tag is always allowed by area rules.
- **Executor calls.** The Executor tool is one entry point for many connectors. Its call is refused before it runs when its code names a blocked connector or a tool of a blocked risk class.
- **Approvals.** In `runtime-mcp-controller.ts`, a connector call waits for approval when trust resolution says `ask` or any of the user's Teams marks its risk class **Approval required**. The Team rule also overrides the agent's `approval_overrides`. The request records `permission_request.team_id`, naming the first Team by name, and lists other Teams with the same rule in its context.

### The Team owner approves

An approval a Team rule held goes to the Team owner's Inbox. If the owner has left the workspace, it goes to workspace owners and admins instead. `teamPolicyApproverIds` in `packages/db/src/inbox.ts` routes it.

`POST /api/permission-requests/:id/resolve` and `POST /api/chat/threads/:id/tool-approval` accept a decision from anyone with `permissionManage`, as before, or from the current owner of the request's Team. The routes read `team.owner_user_id` when the decision arrives, so after an ownership transfer the new owner can decide open requests and the previous owner gets 403. A Team owner's decision is scoped to their Team's requests. Another Team's owner gets 403.

### API and events

| Method | Endpoint | Who | Behavior |
| --- | --- | --- | --- |
| `GET` | `/api/teams/:teamId/agent-policy` | Workspace managers and the Team owner | `{ team_id, policy, can_edit, updated_at }`. The default no-limits policy when none is saved. |
| `PUT` | `/api/teams/:teamId/agent-policy` | Workspace managers | Replaces the policy. Invalid bodies return 400 with `TEAM_AGENT_POLICY_INVALID`. |

A write publishes `team:policy_updated` with the workspace and Team IDs only. The realtime hub delivers it to workspace managers and the Team owner, and clients refetch the `teams` cache.

## What is not built

- The approval card in chat does not name the Team yet. The design's "Waiting for Fred (Technical Team owner)" line needs the card to read `team_id`.
- The Inbox item goes to whoever owned the Team when the request was made. After a transfer, the new owner can decide the request but does not get an Inbox item for it.
- No agent tools belong to the Inbox or Workflows areas today, so switching those areas off removes nothing yet. Issue-run lifecycle tools such as `post_comment` and `update_plan` are untagged on purpose, because removing them would strand the run.
- Codemode's `execute` tool exposes no inner tools today, so there is nothing to remove from it. Executor's tool is an outer tool, so its approvals pause the run as usual.
- Connector access lists Garden's connector registry. Executor integrations with no registry entry cannot be blocked one by one; switching off Connections removes them all.
- `permission_request.team_id` is a plain foreign key, not a composite one, because `permission_request` has no `workspace_id` column. The routes check the Team's workspace instead.
- Retention, external sharing, organization policy, and autonomous-action levels belong to a future workspace policy, not to a Team.
- An issue run uses the Teams of the user who started it, not the issue's Team.
