---
title: Teams group people and agents, and scope who sees which issues
description: How Teams work in a workspace, who can manage them, how invites add people to Teams, how admins reach them from Settings, how a Team agent policy caps agents, and why Team realtime events carry identifiers only.
status: current
owner: "@Umoren"
last_reviewed: 2026-11-10
---

Related issue: [#155](https://github.com/Flow-Research/garden/issues/155)

A Team is a group inside a workspace, such as Engineering or Finance. It holds people and agents, has one human owner, and can own issues. Teams decide who sees which Team issues, so they are both an organizing tool and an access rule.

## Roles decide what each person can do

Three roles meet on a Team. The server enforces each rule; the UI only hides controls a person cannot use.

| Who                      | Sees                                                             | Can change                                                                                                                             |
| ------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace owner or admin | Every Team and every Team issue                                  | Create, edit, and delete any Team, manage members, and transfer ownership                                                              |
| Team owner               | Their Team and all of its issues                                 | Edit their Team and manage its members. They cannot transfer ownership or delete the Team.                                             |
| Team member              | The Teams they belong to, and every issue on those Teams' boards | Nothing on the Team itself. On a Team issue they can change status, position, and fields, comment, and assign the issue to themselves. |

A Team has exactly one human owner. An agent can be a member but never the owner. A Team with issues cannot be deleted; the API returns `TEAM_HAS_ISSUES`.

The `can_manage` and `can_transfer_owner` fields in a Team response are rendering hints. `requireTeamAccess`, `requireTeamManage`, and `requireTeamOwnerTransfer` in `apps/web/src/lib/server/team-access.ts` make the actual decision on every request.

## Database errors map by constraint name

`mapDbError` in `apps/web/src/lib/server/teams.ts` turns Postgres failures into stable `{ error, code }` responses. It keys off constraint names, not message text.

| Postgres           | Constraint                                                                      | API code                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `23503` FK         | `issue_team_workspace_fk`                                                       | `TEAM_HAS_ISSUES` (409) — Team still has linked issues (including a delete race after the empty-Team pre-check) |
| `23503` FK         | Team member / owner identity FKs (for example `team_member_user_id_user_id_fk`) | `INVALID_TEAM_MEMBER` (400)                                                                                     |
| `23514` check      | Member identity check                                                           | `INVALID_TEAM_MEMBER` (400)                                                                                     |
| `23505` unique     | `team_workspace_name_unique`                                                    | `TEAM_NAME_EXISTS` (409)                                                                                        |
| `23505` unique     | Other Team uniques                                                              | `TEAM_MEMBER_EXISTS` (409)                                                                                      |
| Other / unknown FK | —                                                                               | `TEAM_OPERATION_FAILED` (500)                                                                                   |

Delete still pre-checks for linked issues and returns `TEAM_HAS_ISSUES` without hitting the FK when it can. The `issue_team_workspace_fk` branch covers the race where an issue is inserted between that check and the Team delete.

## Team members work the whole Team board

Every member of a Team sees every issue on that Team's board, whoever the issue is assigned to. A workspace member outside the Team sees none of its issues. Workspace owners and admins see every Team issue. Workspace issues, which have no Team, stay visible to every workspace member.

Engineering teams import their GitHub issues onto a Team board, and most of those issues are assigned to someone else or to nobody yet. Before this rule, a normal member saw only the Team issues assigned to them, so an imported board looked almost empty to the engineers who were meant to work it.

The rule lives in one module, `packages/db/src/team-issue-visibility.ts`. `canViewTeamIssue` decides a single issue or realtime event. `teamIssueVisibilityCondition` is the SQL form for collection queries. These callers use it:

| Surface                                                                                              | Caller                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Issue detail, update, comments, and subresources                                                     | `requireIssueAccess` in `apps/web/src/lib/server/issue-access.ts`                                                                                                     |
| Issue list, search, and child progress                                                               | `apps/web/src/routes/api/issues.ts`, `issues/search.ts`, `issues/child-progress.ts`                                                                                   |
| Realtime issue and comment events                                                                    | `canReceiveRealtimeEvent` in `packages/agent-runtime/src/realtime-audience.ts`                                                                                        |
| The chat agent's `list_issues` tool                                                                  | `listIssues` in `packages/server/src/issues/server.ts`, as the chat owner sees the workspace                                                                          |
| The chat agent's `read_issue`, `post_issue_comment`, `assign_issue`, and `update_issue_status` tools | `readIssue` and `resolveVisibleIssue` in `packages/server/src/issues/server.ts`, as the chat owner sees the workspace. A hidden Team issue returns `Issue not found.` |

The Team owner needs no separate term. Creating a Team adds its owner as a member, an ownership transfer requires an existing member, and the owner cannot be removed. Team issue counts in `GET /api/teams` and `GET /api/teams/:teamId` count the whole board, because only managers and members can open a Team.

Write access follows read access, with limits on assignment and Team moves. A member can update any issue on their Team's board and comment on it, so they can move cards across the board and pick up work. A Team issue may be unassigned. When it has an assignee, that assignee must be a member of the Team or an agent on the Team, and `POST /api/issues` and `PUT /api/issues/:id` reject any other assignee with `Assignee must be a Team member`, including when an issue moves onto a Team. A member can assign a Team issue only to themselves. Through the API a member may create a Team issue unassigned or assigned to themselves; the create modal on a Team page locks the assignee to that member. Assigning a Team issue to someone else, clearing an assignee, and moving an issue between Teams stay with the Team owner and workspace owners and admins, whose assignee picker offers **Unassigned** on Team issues. Deleting an issue needs the workspace `issue:update` permission, which normal members do not have. The `PUT` and `DELETE` handlers in `apps/web/src/routes/api/issues/$id.ts` enforce these limits.

The create rules live in the issue service, not in a route. `createIssue` in `packages/server/src/issues/server.ts` calls `authorizeTeamIssueCreate` whenever a `teamId` is set. The creator must be on the Team unless they are a workspace owner or admin, a normal member may assign only themselves, and any assignee must be on the Team. `POST /api/issues` and the chat agent's `create_issue` tool both go through it, so an agent filing a Team issue for its chat owner gets the same answer the web UI would.

## Invites add people to Teams

An invitation can name the Teams its invitee joins. Before this, accepting an invite created only the workspace membership, so a new member opened `/teams` and saw an empty board until someone added them by hand.

`POST /api/workspaces/:id/members` takes an optional `team_ids` array. Only workspace owners and admins create invites, through Better Auth's `createInvitation`, and they may attach any Team in the workspace. `planInvitationTeams` in `apps/web/src/lib/server/invitation-teams.ts` checks the Teams before the invite exists. A Team id that is not in the workspace returns `404 TEAM_NOT_FOUND`, and any other caller gets `403 INVITATION_TEAM_FORBIDDEN`. When the invite names no Team and the workspace has a default Team, the invite joins the default Team. A resend that names Teams adds them to the existing invite. A resend that names none keeps its Teams.

Garden records each Team in `invitation_team`. If the invite email fails, the route cancels the invite with Better Auth's `cancelInvitation` and deletes its `invitation_team` rows, because a canceled invite keeps its row and the cascade does not fire.

Acceptance adds Team memberships after the workspace membership exists. It runs on the normal accept path and on the recovery path for a person who is already a member, and it skips Teams the person already belongs to, so a repeated accept leaves one row per Team. A canceled or rejected invite adds no Teams. If the Team write fails, the person still joins the workspace, and the server logs `invitation.join_teams_failed`.

The invite form in **Settings › Members** has a Team picker. Leaving it empty means the default Team applies.

Team owners cannot invite people yet. Plain members do not hold Better Auth's `invitation:create` permission. A follow-up will grant Team owners that permission through Better Auth access control, rather than bypassing Better Auth.

## The default Team lives on the Teams page

Owners and admins see an **Invites** section on `/teams` with one setting, **Default team for new members**. It is stored in the typed `organization.default_team_id` column, and it is unset by default.

`GET /api/workspaces/:id/team-settings` returns `{ default_team_id }` to any workspace member. `PATCH` changes it and is limited to owners and admins. A `default_team_id` from another workspace returns `404 TEAM_NOT_FOUND`. The column has a plain foreign key to `team.id` with `ON DELETE SET NULL`, so deleting the default Team clears the setting. The service checks the workspace, because a composite `(default_team_id, id)` key would try to null `organization.id` on delete.

## Teams live at `/teams`

Teams has one home in the app:

| Route            | What it shows                                                                                                                                                                                                                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/teams`         | Owners and admins see summary cards, a grid of Team cards with create, edit, delete, and ownership actions, and the **Invites** settings. Members see a Team selector and their Team's issues.                                                                                                     |
| `/teams/$teamId` | Team detail with **Members**, **Issues**, and **Repositories** tabs. The tab is URL state (`?tab=members`, `?tab=issues`, or `?tab=repositories`), and an unknown value falls back to Members. **Repositories** lists linked GitHub repositories; see [GitHub issue sync](./github-issue-sync.md). |
| `/teams/issues`  | Issues across every Team, for owners and admins                                                                                                                                                                                                                                                    |

The sidebar links to `/teams`. Settings links to it too.

## Settings opens the Teams page

Workspace owners and admins see a **Teams** entry under the workspace section of Settings. It is not a Settings tab. Clicking it closes Settings, then navigates to `/teams`, so the Teams page never mounts under the open modal. Members do not see the entry, and it stays hidden while the member list loads.

The entry exists so admins who look for Team management in Settings find it. Settings does not copy the Teams pages, and there is no Settings-specific Teams API. `TeamsSettingsLink` in `apps/web/src/features/settings/components/settings-page.tsx` implements it.

Settings remembers its selected tab. `useSettingsDialogStore` keeps `activeTab` while the dialog is closed, so reopening Settings returns to the last tab. `openSettings('members')` still deep-links to a tab.

## The client caches one Team list shape

`GET /api/teams` returns `{ teams, total, unique_member_count }`. `teamListOptions` in `apps/web/src/features/teams/queries.ts` caches that whole response, and each caller reads `.teams` itself. The overview needs `unique_member_count` for its member card, which counts a person on two Teams once.

Team query keys are scoped by workspace: `['teams', workspaceId, 'list']`, `['teams', workspaceId, 'detail', teamId]`, `['teams', workspaceId, 'members', teamId]`, and `['issues', workspaceId, 'team', teamId]`. Queries keep the previous data while they refetch, so navigation and mutations do not flash an empty state.

## The API is the contract

| Method       | Endpoint                                              | Behavior                                                                                                          |
| ------------ | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `GET`        | `/api/teams`                                          | Visible Teams, total, and distinct visible member count                                                           |
| `POST`       | `/api/teams`                                          | Create a Team and optional initial members in one transaction                                                     |
| `GET`        | `/api/teams/:teamId`                                  | Caller-relative Team detail and counts                                                                            |
| `PATCH`      | `/api/teams/:teamId`                                  | Update name or description                                                                                        |
| `DELETE`     | `/api/teams/:teamId`                                  | Delete a Team with no issues. Owners and admins only.                                                             |
| `GET`        | `/api/teams/:teamId/members`                          | Member rows for users and agents                                                                                  |
| `POST`       | `/api/teams/:teamId/members`                          | Add one user or agent from the same workspace                                                                     |
| `DELETE`     | `/api/teams/:teamId/members/:membershipId`            | Remove a member. The owner cannot be removed.                                                                     |
| `PUT`        | `/api/teams/:teamId/owner`                            | Transfer ownership to a human member. Owners and admins only.                                                     |
| `GET`        | `/api/teams/:teamId/repositories`                     | GitHub repositories linked to the Team, with import state                                                         |
| `GET`        | `/api/teams/:teamId/repositories/available`           | Repositories the workspace's GitHub App can access, marked with the Team each is linked to. Team managers only.   |
| `POST`       | `/api/teams/:teamId/repositories`                     | Link a repository by `github_repo_id` and start its import. Team managers only.                                   |
| `DELETE`     | `/api/teams/:teamId/repositories/:repositoryId`       | Unlink a repository. Imported issues stay. Team managers only.                                                    |
| `POST`       | `/api/teams/:teamId/repositories/:repositoryId/retry` | Run a failed import again. Team managers only.                                                                    |
| `GET`, `PUT` | `/api/teams/:teamId/agent-policy`                     | Read or replace the Team agent policy. See [Agent policy](#agent-policy-caps-what-agents-do-for-a-teams-members). |

Request bodies use the Zod schemas in `apps/web/src/lib/server/validation/teams.ts`. Errors use the `{ error, code }` envelope. The tables are `team`, `team_member`, and `invitation_team` in `packages/db/src/schema/teams.ts`, and `issue.team_id` links an issue to its Team. Invite and invite-settings endpoints are described in [Invites add people to Teams](#invites-add-people-to-teams).

## Realtime events say what changed, not what it looks like

After a successful write, the route publishes a workspace event: `team:created`, `team:updated`, `team:deleted`, `team_member:added`, `team_member:removed`, or `team:policy_updated`. A refused write publishes nothing.

The payloads carry identifiers only: workspace, Team, membership, member type, and the user or agent ID. Every Team member's socket receives these events, so a Team DTO would leak the publisher's `can_manage` flag and the counts they can see. `team:deleted` no longer carries the Team name for the same reason. Clients invalidate the `teams` cache and refetch. The realtime hub keeps each socket's list of Teams current from `team_member:added`, `team_member:removed`, and `team:deleted`. See [Realtime](../architecture/realtime.md).

## Members link a GitHub identity

A workspace member row can carry a GitHub identity: `member.github_user_id` (the stable numeric ID) and `member.github_login` (the current handle). The two columns are set together or cleared together, and the database enforces that pair with a check constraint. A partial unique index stops two members in one workspace from claiming the same `github_user_id`.

A member links their own GitHub identity from **Settings → Account → Link with GitHub**. `GET /api/github/identity/start` signs a state token bound to the member and their workspace with purpose `identity`, then sends them to GitHub's user authorization page for the Garden GitHub App. GitHub returns to the App's registered `/api/github/callback`; a request with `code` and no `installation_id` is forwarded to `GET /api/github/identity/complete`. That route rejects install-purpose or expired state and a session that is not the one that started the flow, exchanges the code, reads `/user`, and writes the verified `id` and `login` to the caller's own member row. GitHub proves the account belongs to the member, so this path needs no owner or admin role. The user access token is used once and not stored. The member lands on Home with `github_identity=linked`, `taken` (the account is already linked to another member), or `failed`. `POST /api/github/identity/unlink` clears the caller's own link.

Owners and admins can still link or clear any member's identity by hand. `PATCH /api/workspaces/:id/members/:memberId` with `github_user_id` and `github_login` links, refreshes, or clears it. Only owners and admins can call it, and only an owner can edit an owner's row, the same rule role edits use. A non-manager gets `403` before Garden reads the target row, so the response does not reveal which member IDs exist. A body that keeps the same `github_user_id` only refreshes the login, so a GitHub rename keeps the link. The Members tab resolves a typed login to its ID before saving. `GET /api/workspaces/:id/members` returns both fields.

Agents read the identity from `list_workspace_inventory` as `github_identity`, either `linked` with `user_id` and `login` or `not_linked`. When an agent assigns a mirrored GitHub issue, it passes linked logins as `issue_write.assignees` and asks the person to link first when they are not linked. It does not guess a handle. The runtime enforces this: `issue_write` rejects any assignee login that no member of the calling workspace has linked. On an existing issue, assignees are added through GitHub's add-assignees endpoint, so people already assigned stay assigned. The same check covers the hosted GitHub MCP `issue_write`, which Garden exposes beside the native tool. Its update replaces the assignee list, so Garden refuses assignees on a hosted update and points the agent to the native `issue_write`.

A stored `github_login` goes stale when the person renames their GitHub account; until the upcoming identity sync refreshes it, the member links again with GitHub, or an owner or admin re-links them.

## Agent policy caps what agents do for a Team's members

Garden has one shared agent per workspace, so a Team cannot have its own agent. Instead, a Team can carry an agent policy. It applies whenever any agent acts for one of the Team's members: the owner of the chat, or the user who started the issue or automation run. A user on no Team is unaffected.

A policy is a ceiling. It can switch tools off and add approvals. It never grants a tool the agent's own permissions lack. A person on two Teams gets the stricter rule from each, so blocks and approvals are unions.

| Tab                 | What the admin sets                                                                                                                                                                                                                     | Stored as                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Agent Permissions   | **Access** checkboxes for the areas agents may use: Tasks, Knowledge, Inbox, Connections, Workflows, Skills. Below them, **Restricted** checkboxes block the Destructive actions and Sending outside the workspace risk classes.        | `allowed_areas`, `blocked_risk_classes`                                  |
| Connector Grants    | A card with the connector's logo, its workspace setup status, and a switch. All are on until an admin turns one off.                                                                                                                    | `blocked_connector_ids` (a blocklist, so a new connector starts allowed) |
| Task Approval Rules | Write changes, Sending outside the workspace, and Destructive actions are each **Follow agent settings** or **Approval required** in a select. **Default Approver** shows the Team owner, read-only; workspace admins can also approve. | `approval_required`                                                      |

`TeamAgentPolicySchema` in `packages/core/src/teams/agent-policy.ts` is the one shape for the API, the database, and the runtime. It is strict, so an unknown key or value fails validation. The `team_agent_policy` table holds one row per Team. No row means no limits.

### Who can see and change it

| Who                      | Can                                                                           |
| ------------------------ | ----------------------------------------------------------------------------- |
| Workspace owner or admin | Read and change the policy                                                    |
| Team owner               | Read it. The panel is read-only and says only workspace admins can change it. |
| Team member              | Nothing. `GET` returns 403.                                                   |

The Team detail page's actions menu has **Agent policy** for workspace managers and the Team owner. It opens a **Team settings** side sheet with the three tabs, **Cancel**, and **Save Changes**. Saving updates the cached policy at once and rolls it back if the server refuses. `TeamAgentPolicySheet` in `apps/web/src/features/teams/components/team-agent-policy-sheet.tsx` implements it.

Design controls with no backing in Garden still render, disabled, with a **Coming soon** badge: the Chats and Home areas; the Delete projects, Manage billing, and Read locked files restrictions; the Deploy changes and Create documents approval rows; the per-member Team Role select; and the Admin Policy tab. They store nothing, and the schema rejects them if a client sends them.

### How the runtime applies it

`loadTeamAgentPolicyForUser` in `packages/core/src/teams/agent-policy-store.ts` reads every policy for the acting user's Teams and folds them with `combineTeamAgentPolicies`. The runtime reads it every turn and on every approval decision, so a saved policy applies to the next decision. A stored row that fails the schema counts as the strictest policy.

- **Tool existence.** `evaluateRuntimeToolPermission` in `packages/agent-runtime/src/chat-permissions.ts` checks the Team ceiling first, then the agent's permissions. A blocked tool is left out of the chat or run tool list and refused if called. Each native tool's area comes from `AGENT_TOOL_AREAS` in the same file. Connector and Executor tools are in Connections, and a connector tool's risk class comes from the connector registry. A tool with no area tag is always allowed by area rules.
- **Executor calls.** The Executor tool is one entry point for many connectors. Its call is refused before it runs when its code names a blocked connector or a tool of a blocked risk class.
- **Approvals.** In `runtime-mcp-controller.ts`, a connector call waits for approval when trust resolution says `ask` or any of the user's Teams marks its risk class **Approval required**. The Team rule also overrides the agent's `approval_overrides`. The request records `permission_request.team_id`, naming the first Team by name, and lists other Teams with the same rule in its context.

### The Team owner approves

An approval a Team rule held goes to the Team owner's Inbox. If the owner has left the workspace, it goes to workspace owners and admins instead. `teamPolicyApproverIds` in `packages/db/src/inbox.ts` routes it.

`POST /api/permission-requests/:id/resolve` and `POST /api/chat/threads/:id/tool-approval` accept a decision from anyone with `permissionManage`, as before, or from the current owner of the request's Team. The routes read `team.owner_user_id` when the decision arrives, so after an ownership transfer the new owner can decide open requests and the previous owner gets 403. A Team owner's decision is scoped to their Team's requests. Another Team's owner gets 403.

### API and events

| Method | Endpoint                          | Who                                   | Behavior                                                                                      |
| ------ | --------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------- |
| `GET`  | `/api/teams/:teamId/agent-policy` | Workspace managers and the Team owner | `{ team_id, policy, can_edit, updated_at }`. The default no-limits policy when none is saved. |
| `PUT`  | `/api/teams/:teamId/agent-policy` | Workspace managers                    | Replaces the policy. Invalid bodies return 400 with `TEAM_AGENT_POLICY_INVALID`.              |

A write publishes `team:policy_updated` with the workspace and Team IDs only. The realtime hub delivers it to workspace managers and Team members, the same audience as other Team events, and clients refetch the `teams` cache.

## What is not built

- The approval card in chat does not name the Team yet. The design's "Waiting for Fred (Technical Team owner)" line needs the card to read `team_id`.
- The Inbox item goes to whoever owned the Team when the request was made. After a transfer, the new owner can decide the request but does not get an Inbox item for it.
- No agent tools belong to the Inbox or Workflows areas today, so switching those areas off removes nothing yet. Issue-run lifecycle tools such as `post_comment` and `update_plan` are untagged on purpose, because removing them would strand the run.
- Codemode's `execute` tool exposes no inner tools today, so there is nothing to remove from it. Executor's tool is an outer tool, so its approvals pause the run as usual.
- Connector access lists Garden's connector registry. Executor integrations with no registry entry cannot be blocked one by one; switching off Connections removes them all.
- `permission_request.team_id` is a plain foreign key, not a composite one, because `permission_request` has no `workspace_id` column. The routes check the Team's workspace instead.
- Retention, external sharing, organization policy, and autonomous-action levels belong to a future workspace policy, not to a Team.
- An issue run uses the Teams of the user who started it, not the issue's Team.
