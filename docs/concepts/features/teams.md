---
title: Teams group people and agents, and scope who sees which issues
description: How Teams work in a workspace, who can manage them, how admins reach them from Settings, and why Team realtime events carry identifiers only.
status: current
owner: "@Umoren"
last_reviewed: 2026-11-07
---

A Team is a group inside a workspace, such as Engineering or Finance. It holds people and agents, has one human owner, and can own issues. Teams decide who sees which Team issues, so they are both an organizing tool and an access rule.

## Roles decide what each person can do

Three roles meet on a Team. The server enforces each rule; the UI only hides controls a person cannot use.

| Who | Sees | Can change |
| --- | --- | --- |
| Workspace owner or admin | Every Team and every Team issue | Create, edit, and delete any Team, manage members, and transfer ownership |
| Team owner | Their Team and all of its issues | Edit their Team and manage its members. They cannot transfer ownership or delete the Team. |
| Team member | The Teams they belong to, and every issue on those Teams' boards | Nothing on the Team itself. On a Team issue they can change status, position, and fields, comment, and assign the issue to themselves. |

A Team has exactly one human owner. An agent can be a member but never the owner. A Team with issues cannot be deleted; the API returns `TEAM_HAS_ISSUES`.

The `can_manage` and `can_transfer_owner` fields in a Team response are rendering hints. `requireTeamAccess`, `requireTeamManage`, and `requireTeamOwnerTransfer` in `apps/web/src/lib/server/team-access.ts` make the actual decision on every request.

## Team members work the whole Team board

Every member of a Team sees every issue on that Team's board, whoever the issue is assigned to. A workspace member outside the Team sees none of its issues. Workspace owners and admins see every Team issue. Workspace issues, which have no Team, stay visible to every workspace member.

Engineering teams import their GitHub issues onto a Team board, and most of those issues are assigned to someone else or to nobody yet. Before this rule, a normal member saw only the Team issues assigned to them, so an imported board looked almost empty to the engineers who were meant to work it.

The rule lives in one module, `packages/db/src/team-issue-visibility.ts`. `canViewTeamIssue` decides a single issue or realtime event. `teamIssueVisibilityCondition` is the SQL form for collection queries. These callers use it:

| Surface | Caller |
| --- | --- |
| Issue detail, update, comments, and subresources | `requireIssueAccess` in `apps/web/src/lib/server/issue-access.ts` |
| Issue list, search, and child progress | `apps/web/src/routes/api/issues.ts`, `issues/search.ts`, `issues/child-progress.ts` |
| Realtime issue and comment events | `canReceiveRealtimeEvent` in `packages/agent-runtime/src/realtime-audience.ts` |
| The chat agent's `list_issues` tool | `listIssues` in `packages/server/src/issues/server.ts`, as the chat owner sees the workspace |

The Team owner needs no separate term. Creating a Team adds its owner as a member, an ownership transfer requires an existing member, and the owner cannot be removed. Team issue counts in `GET /api/teams` and `GET /api/teams/:teamId` count the whole board, because only managers and members can open a Team.

Write access follows read access, with limits on assignment and Team moves. A member can update any issue on their Team's board and comment on it, so they can move cards across the board and pick up work. A member can assign a Team issue only to themselves, and creates Team issues assigned to themselves. Assigning a Team issue to someone else and moving an issue between Teams stay with the Team owner and workspace owners and admins. Deleting an issue needs the workspace `issue:update` permission, which normal members do not have. The `PUT` and `DELETE` handlers in `apps/web/src/routes/api/issues/$id.ts` enforce these limits.

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

The payloads carry identifiers only: workspace, Team, membership, member type, and the user or agent ID. Every Team member's socket receives these events, so a Team DTO would leak the publisher's `can_manage` flag and the counts they can see. `team:deleted` no longer carries the Team name for the same reason. Clients invalidate the `teams` cache and refetch. The realtime hub keeps each socket's list of Teams current from `team_member:added`, `team_member:removed`, and `team:deleted`. See [Realtime](../architecture/realtime.md).

## Members link a GitHub identity

A workspace member row can carry a GitHub identity: `member.github_user_id` (the stable numeric ID) and `member.github_login` (the current handle). The two columns are set together or cleared together, and the database enforces that pair with a check constraint. A partial unique index stops two members in one workspace from claiming the same `github_user_id`.

`PATCH /api/workspaces/:id/members/:memberId` with `github_user_id` and `github_login` links, refreshes, or clears the identity. Only workspace owners and admins can call it, for any member row including their own, and only an owner can edit an owner's row, the same rule role edits use. A non-manager gets `403` before Garden reads the target row, so the response does not reveal which member IDs exist. A plain member gets `403`, even on their own row, because Garden does not yet verify that the submitted GitHub account belongs to the person who submits it. Without that check, a member could link someone else's account to their own row and receive that person's mirrored issue assignments. A body that keeps the same `github_user_id` only refreshes the login, so a GitHub rename keeps the link. Owners and admins link identities from the Members tab, which resolves a login to its ID before saving. Account settings shows the current user's identity read-only and tells them that an owner or admin links it. Self-serve linking returns once Garden proves ownership through GitHub OAuth; see [Known gaps](../../reference/known-gaps.md). `GET /api/workspaces/:id/members` returns both fields.

Agents read the identity from `list_workspace_inventory` as `github_identity`, either `linked` with `user_id` and `login` or `not_linked`. When an agent assigns a mirrored GitHub issue, it passes linked logins as `issue_write.assignees` and asks the person to link first when they are not linked. It does not guess a handle. The runtime enforces this: `issue_write` rejects any assignee login that no member of the calling workspace has linked. On an existing issue, assignees are added through GitHub's add-assignees endpoint, so people already assigned stay assigned. The same check covers the hosted GitHub MCP `issue_write`, which Garden exposes beside the native tool. Its update replaces the assignee list, so Garden refuses assignees on a hosted update and points the agent to the native `issue_write`.

A stored `github_login` goes stale when the person renames their GitHub account; until the upcoming identity sync refreshes it, an owner or admin re-links the member to update the login.

## What is not built

The admin designs also show per-Team policy: agent permissions, admin policy, connector grants, and task approval rules for each Team. None of that exists yet. It needs its own spec for the data model, API, and enforcement before any UI work.
