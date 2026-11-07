---
title: GitHub issue sync fills Team boards from linked repositories
description: How a Team links GitHub repositories, how Garden imports their open issues and creates issues for new ones, and how GitHub state maps onto Garden issues.
status: current
owner: "@Umoren"
last_reviewed: 2026-11-07
---

Builds on [#196](https://github.com/Flow-Research/garden/pull/196) (one GitHub App token path), [#170](https://github.com/Flow-Research/garden/pull/170) (member GitHub identities), and [#236](https://github.com/Flow-Research/garden/pull/236) (signed webhook updates for linked issues).

## What the feature does

Each Flow Research product team (Garden, Workstream, LMS, Blockchain) tracks its work in GitHub repositories under the Flow-Research organization. A Team owner or workspace admin links a repository to a Team once. Garden imports the repository's open issues onto that Team's board. After that, every new GitHub issue appears on the board within seconds, assigned to the Garden member whose GitHub account matches.

## Why it works this way

**The repository's numeric ID is the key.** `team_repository` is unique on `(workspace_id, github_repo_id)`. Full names change on rename, and the numeric ID does not. A repository belongs to exactly one Team in a workspace, so every GitHub issue has one board. A person on several Teams sees each board through `team_member`.

**Imported issues reuse the existing link.** Each issue gets an `issue_source_binding` row with `connector_id = 'github'`, `source_kind = 'issue'`, `external_id = 'Owner/repo#<n>'`, and the GitHub `html_url`. `read_source`, comment write-back, and the webhook route already read this format.

**Bindings match on the repository ID, not only the name.** A synced binding stores `github_repo_id`, `github_issue_number`, and `github_issue_node_id` in its `metadata`. `githubIssueBindingMatch` finds a binding by any external ID form, by its URL, or by that repository ID and issue number. The webhook, the create step, and the import all use it. An earlier version matched names only, so after a repository rename the next event created a second Garden issue for the same GitHub issue. A `repository.renamed` or `repository.transferred` delivery rewrites the link's `full_name` and every binding for that repository to the new name. That includes bindings someone attached by hand under the old name, which also gain the repository ID metadata.

**Creation is insert-only.** `upsertGitHubIssue` creates the Garden issue and its binding, or finds the one that exists. It never rewrites an existing issue. The import and every webhook call it, and a retry, a redelivery, or an import running beside a webhook must converge on one row. A transaction-scoped advisory lock on the repository ID and issue number serializes two writers for one GitHub issue, even when one of them still holds the old repository name. The existing-binding check is `githubIssueBindingMatch`, so an issue someone linked by hand is not imported twice. Updates to an existing issue go through the webhook delivery ledger, which orders them. If the import also refreshed fields, a late import page could overwrite a newer webhook change.

**Creation records an order marker.** When `upsertGitHubIssue` creates an issue, it writes a `garden_sync` row to `github_webhook_delivery` with the snapshot's GitHub `updated_at` as the marker, in the binding's issue scope. A webhook older than that snapshot is then `stale`, the same way the ledger orders two webhooks. An earlier version wrote no marker, so an `edited` delivery that GitHub sent before the import read the issue could still roll the title back.

**A webhook can create the issue before the import reaches it.** Every `issues` action Garden applies creates the Garden issue when the repository is linked and no binding exists yet. An open issue is always created. A closed issue is created only while the link's import has not finished. Without this, a close that arrived before the import reached the issue was dropped as unbound, and the import then wrote the issue open from its older page. Created from the delivery, the issue carries the close and its marker, and the import finds it and leaves it alone. After the import finishes, a closed issue that is not on the board stays off it.

**A Workflow owns the import.** `GitHubRepoImportWorkflow` imports one page of 100 open issues per step from `GET /repositories/{id}/issues`, so a rename the link has not seen yet does not break it. Its instance ID is the `team_repository.id`, so a second start for one link is a no-op, and **Retry** restarts the same instance. Workflows retry a failed page on their default policy without repeating finished pages. Every step reloads the link and stops when someone unlinked the repository.

**The import pages by `updated_at`, not by offset.** Each step returns a cursor: `since` one second before the last issue it saw, and a page number inside that window (`nextIssueListCursor`). An earlier version paged `state=open` by offset. An issue closed on page 1 while page 2 was pending shifted every later issue down one slot, so the first issue of page 2 was never imported. Ordered by `updated_at`, an issue that closes or changes leaves the window or moves behind the cursor, and the other issues keep their places. The window starts one second early because GitHub timestamps have one-second resolution. Issues in that second are fetched twice, and the insert-only upsert absorbs the repeat. When a whole page shares one second, the page number advances instead.

**Retry reports a restart it cannot make.** **Retry** restarts the Workflow instance, and creates one only when none exists. When the restart fails and the instance already exists, the link goes back to `failed` and the route answers `503` with `TEAM_REPOSITORY_IMPORT_START_FAILED`, so the row keeps its **Retry import** button. An earlier version read the create step's "already exists" as success and left the link `pending` with nothing running.

**Garden's own App bot can create issues.** The apply step skips deliveries from `<GITHUB_APP_SLUG>[bot]` so Garden's writes to an issue it already holds do not echo back. The create step does not skip it, so an issue an agent opens through the App reaches the Team board.

**Human assignment follows GitHub. Agent assignment stays with Garden.** The first GitHub assignee whose `member.github_user_id` matches becomes the Garden assignee. When no assignee matches, Garden clears a human assignee and records the GitHub logins in the binding's `metadata.github_assignees`. GitHub cannot express an agent assignee, so an agent assignment made in Garden survives GitHub assignment events.

**Open-state updates never move status.** Only `closed` and `reopened` change status. A Garden-side status such as `in_progress` survives GitHub edits, label changes, and assignment changes while the issue stays open.

**Status changes use the shared lifecycle.** The webhook writes status through the delivery ledger and then calls `applyIssueMutationSideEffects`, the helper `PUT /api/issues/$id` uses. A close from GitHub archives inbox items and cancels live runs, the same as a close in Garden.

## Mapping rules

| GitHub | Garden |
| --- | --- |
| Open issue | `todo` on create. Later updates leave the status alone while the issue stays open. |
| Closed as completed | `done` |
| Closed as not planned or as a duplicate | `cancelled` |
| Reopened | `todo` |
| First assignee whose GitHub user ID matches a member | Assignee. With no match, a human assignee is cleared and an agent assignee stays. |
| Labels | `labels` |
| Title and body | `title` and `description`, set on create and on `issues.edited` |
| Author | `created_by` is the member matched to the author, else the user who linked the repository, or the Team owner once that user is deleted (`linked_by` is set null) |
| Pull request | Skipped |

## Scope

In scope:

- Linking and unlinking repositories from the Team's **Repositories** tab.
- The initial import of open issues.
- Every `issues` action Garden applies (`opened`, `edited`, `closed`, `reopened`, `transferred`, `assigned`, `unassigned`, `labeled`, `unlabeled`) creates the Garden issue on a linked repository when it does not exist yet, under the open and closed rule above. For `transferred`, Garden reads the destination issue and repository from `changes.new_issue` and `changes.new_repository`.
- `repository.renamed` and `repository.transferred` rewrite the link's `full_name` and the repository's bindings. Any later issue event also refreshes `team_repository.full_name`.

Out of scope:

- Pull requests as board cards. They stay readable through `read_source` and work-product write-back.
- Sending Garden edits to GitHub beyond today's comment write-back.
- Repositories outside the workspace's GitHub App installation.
- Importing closed issues.
- Changing who can see Team issues. See [Gaps and follow-up](#gaps-and-follow-up).
- Adding an invited person to a Team when they accept a workspace invitation.

## What the user sees

1. A Team owner or workspace admin opens the Team, selects **Repositories**, and selects **Link repository**.
2. The dialog lists the repositories the GitHub App installation can access. A repository already linked to a Team is disabled and labelled with where it is linked.
3. After **Link repository**, the row shows **Import queued**, then **Importing issues…**, then **Synced**. Imported issues appear on the Team's **Issues** tab as each page commits.
4. A new GitHub issue appears on the board without a refresh.
5. When the import fails after retries, the row shows **Import failed** and a **Retry import** button. When **Retry** cannot restart the import, a toast says so and the row stays **Import failed** with its button.
6. **Unlink** stops new issues from arriving. Issues already imported stay on the board, because people may have commented on them or started runs.
7. Without a connected GitHub App installation, linking fails with `GITHUB_NOT_CONNECTED`. A repository the installation cannot access fails with `GITHUB_REPOSITORY_NOT_FOUND`. A repository linked elsewhere fails with `TEAM_REPOSITORY_LINKED`. Unlink and Retry answer `TEAM_REPOSITORY_NOT_FOUND` (404) for an unknown or malformed repository ID.

## Where it lives

- The table is `team_repository` in `packages/db/src/schema/github.ts`, created by migration `0065_opposite_post`.
- The routes are under `apps/web/src/routes/api/teams/$teamId/repositories.ts` and `apps/web/src/routes/api/teams/$teamId/repositories/`. Their service is `apps/web/src/lib/server/team-repositories.ts`.
- GitHub calls go through `createGitHubRequester` in `apps/web/src/lib/server/github-repositories.ts`, which uses the shared installation-token path in `packages/connectors/src/github/rest-client.ts`.
- Issue parsing, member matching, and `upsertGitHubIssue` are in `apps/web/src/lib/server/github-issue-sync.ts`. Numbering and column placement use `allocateIssueSlot` in `packages/server/src/issues/server.ts`, which `createIssue` also uses.
- The Workflow is `GitHubRepoImportWorkflow` in `apps/web/src/github-repo-import-workflow.ts`, bound as `GITHUB_REPO_IMPORT_WORKFLOW`. Page import and start helpers are in `apps/web/src/lib/server/github-repo-import.ts`.
- The webhook create step is `ensureLinkedIssue` in `apps/web/src/routes/api/github/webhook.ts`. The action mapping is `planGitHubWebhookIssueApply` and `nextGitHubAssignee` in `apps/web/src/lib/server/github-webhook-apply.ts`. See [GitHub webhooks](./github-webhook-sync.md).
- The UI is `TeamRepositoriesPanel` in `apps/web/src/features/teams/components/team-repositories-panel.tsx`.

## Data and permissions

Anyone who can see the Team can list its linked repositories. Linking, unlinking, retrying, and listing the installation's repositories require Team management: a workspace owner or admin, or the Team owner (`requireTeamManage`). A Team owner who is a plain workspace member can therefore see the name of every repository the workspace's GitHub App installation can access, including private repositories that belong to other Teams. That matches who can link a repository, so the picker does not narrow the list. The server reads the repository from GitHub by ID before it links, so a link can only name a repository the installation can access, and `full_name` comes from GitHub, not from the client.

The import and the webhook write `issue`, `issue_source_binding`, `github_webhook_delivery` order markers, and `team_repository.import_state`, `imported_at`, and `full_name`. They read `member.github_user_id` to match people. Imported issues publish `issue:created`, and import state changes publish `team:updated`.

The GitHub App needs Issues read access and the Issues, Issue comment, and Repository webhook events. These are set in GitHub's App settings and cannot be checked from the repository. An owner confirms them before release.

## How to verify it

- `pnpm --filter @garden/web exec vitest run src/routes/api/teams/-team-repositories.integration.test.ts` runs against a Postgres container. It covers linking, a repository the installation cannot access, a member without manage rights, the picker's linked markers, a second Workflow start, paged import with a pull request skipped and assignee and author matching, a second import that creates nothing, an issue closed between pages, a failed import with **Retry**, a **Retry** whose restart fails, and concurrent numbering.
- `pnpm --filter @garden/web exec vitest run src/routes/api/github/-webhook.integration.test.ts` covers `opened` on linked and unlinked repositories, redelivery, an issue opened by Garden's App bot, a close that arrives before the import, a webhook older than an imported snapshot, events under a renamed repository, `repository.renamed`, assignee matching with and without a member, label sync, and status mapping.
- `pnpm --filter @garden/web exec vitest run src/features/teams/components/team-repositories-panel.test.tsx` covers the **Repositories** tab.
- End to end in a dev workspace: link the Garden repository, see its open issues on the Garden Team board, open a GitHub issue and see it appear, then close it and see it move to Done.

## Gaps and follow-up

- **Team board visibility.** A normal Team member sees only Team issues assigned to them (`apps/web/src/lib/server/issue-access.ts`), so an imported board shows most members almost nothing. The recommendation is that every Team member sees the whole Team board. That change also touches the realtime audience, Team list counts, the member view, and write rules, so it ships as its own change.
- **Invitation to Team.** Accepting a workspace invitation adds nobody to a Team. The recommendation is an optional Team on the invitation, added on acceptance.
- **Issue transfers.** An issue transferred to another repository gets a new number there, so Garden creates a new issue when the destination is linked. The original Garden issue stays on its board.
- **Rename ordering.** A `repository` delivery applies the name in its payload. Two renames delivered out of order leave the older name on the bindings until the next rename. The next issue event refreshes the link's `full_name`. Matching uses the repository ID, so only display names and comment write-back lag.
- **Agent-attached bindings.** When an agent opens a GitHub issue through the App on a linked repository and then attaches it to its own Garden issue, the create step has usually already put a second Garden issue on the board.
- **Subscribers.** Imported issues get no initial subscribers, so the matched assignee is not subscribed to activity the way `createIssue` subscribes one.
- **Assignee visibility.** A matched assignee who is a workspace member but not a Team member cannot see the issue under today's visibility rule.
- **Closed issues.** The import brings in open issues only. Importing recently closed issues would give history but clutter the Done column.
