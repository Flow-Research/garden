---
title: Teams group people and agents, and scope who sees which issues
description: How Teams work in a workspace, who can manage them, how admins reach them from Settings, and why Team realtime events carry identifiers only.
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

Request bodies use the Zod schemas in `apps/web/src/lib/server/validation/teams.ts`. Errors use the `{ error, code }` envelope. The tables are `team` and `team_member` in `packages/db/src/schema/teams.ts`, and `issue.team_id` links an issue to its Team.

## Realtime events say what changed, not what it looks like

After a successful write, the route publishes a workspace event: `team:created`, `team:updated`, `team:deleted`, `team_member:added`, or `team_member:removed`. A refused write publishes nothing.

The payloads carry identifiers only: workspace, Team, membership, member type, and the user or agent ID, plus `owner_user_id` on created and updated events. Every Team member's socket receives these events, so a Team DTO would leak the publisher's `can_manage` flag and the counts they can see. `team:deleted` no longer carries the Team name for the same reason. Clients invalidate the `teams` cache and refetch. The realtime hub reads `owner_user_id` to keep each socket's list of owned Teams current after a transfer. See [Realtime](../architecture/realtime.md).

## Members link a GitHub identity

A workspace member row can carry a GitHub identity: `member.github_user_id` (the stable numeric ID) and `member.github_login` (the current handle). The two columns are set together or cleared together, and the database enforces that pair with a check constraint. A partial unique index stops two members in one workspace from claiming the same `github_user_id`.

`PATCH /api/workspaces/:id/members/:memberId` with `github_user_id` and `github_login` links, refreshes, or clears the identity. Members edit their own; workspace owners and admins edit anyone's. A body that keeps the same `github_user_id` only refreshes the login, so a GitHub rename keeps the link. The Members tab and Account settings resolve a login to its ID before saving. `GET /api/workspaces/:id/members` returns both fields.

Agents read the identity from `list_workspace_inventory` as `github_identity`, either `linked` with `user_id` and `login` or `not_linked`. When an agent assigns a mirrored GitHub issue, it passes linked logins as `issue_write.assignees` and asks the person to link first when they are not linked. It does not guess a handle.

## What is not built

The admin designs also show per-Team policy: agent permissions, admin policy, connector grants, and task approval rules for each Team. None of that exists yet. It needs its own spec for the data model, API, and enforcement before any UI work.
