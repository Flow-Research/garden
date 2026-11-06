---
title: GitHub issue sync for team boards
description: Proposal to link GitHub repositories to Garden teams, import their issues, and create Garden issues for new GitHub issues so each product team's board fills itself.
status: proposal
owner: "@Umoren"
last_reviewed: 2026-11-06
---

**Date:** 2026-11-06. **Audience:** Garden engineers and reviewers. **Direction:** [Context layer and Flow Research onboarding](./context-layer-direction.md).

> **Not built.** This builds on three open pull requests by Tunji Adeyemi: #196 (one GitHub App token path), #170 (member GitHub identities), and #236 (signed webhook updates for linked issues). It starts after #196 and #170 merge.

## 1. Purpose

Each Flow Research product team (Garden, Workstream, LMS, Blockchain) tracks its work in its own GitHub repositories under the Flow-Research organization. Garden boards stay empty because nothing brings those issues in. #236 updates a Garden issue that is already linked to a GitHub issue, but no code creates the Garden issue in the first place, and no screen links one.

After this change, a team admin links a repository to a team once. Garden imports the repository's open issues onto that team's board, and every new GitHub issue appears there within seconds, assigned to the matching Garden member.

## 2. Non-goals

- Pull requests as board cards. They stay readable through `read_source` and work-product write-back.
- Outbound sync of Garden edits to GitHub beyond today's comment write-back.
- Repositories outside the workspace's single GitHub App installation.
- Changing who can see team issues. That is a separate decision recorded in section 8.

## 3. Data shape

One new table links repositories to teams.

```ts
team_repository {
  id: uuid
  workspaceId: uuid            // FK organization
  teamId: uuid                 // composite FK (teamId, workspaceId) → team
  githubRepoId: bigint         // stable across renames and transfers
  fullName: text               // "Flow-Research/garden", refreshed on rename
  linkedBy: uuid               // FK user; createdBy for imported issues
  importState: 'pending' | 'importing' | 'ready' | 'failed'
  importedAt: timestamp | null
  createdAt: timestamp
  unique (workspaceId, githubRepoId)   // a repository belongs to one team
}
```

The repository's numeric ID is the key, because full names change on rename. A repository belongs to exactly one team so every issue has one board. A person on several teams sees each team's board through `team_member`, which already allows multiple memberships.

Imported issues reuse the existing link. Each one gets an `issue_source_binding` row with `connectorId: 'github'`, `sourceKind: 'issue'`, `externalId: 'Flow-Research/<repo>#<n>'`, and the GitHub `html_url`. The existing unique index on `(workspaceId, connectorId, sourceKind, externalId)` makes every import and webhook write an upsert, so a retry or a duplicate delivery converges on the same row. `read_source`, write-back, and #236 already parse this format.

## 4. Mapping rules

| GitHub | Garden |
| --- | --- |
| Open issue | `todo` on create. Later updates leave a Garden-side status such as `in_progress` alone while the issue stays open. |
| Closed as completed | `done` |
| Closed as not planned | `cancelled` |
| Reopened | `todo` |
| First assignee whose GitHub user ID matches a member (#170) | Assignee. Unmatched or missing assignees leave the issue unassigned and keep the GitHub logins in binding metadata. |
| Labels | `labels` |
| Title and body | `title` and `description` |
| Author | `createdBy` is the member matched to the author, else the user who linked the repository |

Status changes go through the normal Garden issue lifecycle, the same path #236 must adopt, so inbox archival and live-run cancellation still run.

## 5. Flows

**Link a repository.** A team admin opens the team's settings, picks a repository from those the GitHub App installation can access, and saves. The server writes `team_repository` with `importState: 'pending'` and starts the import.

**Initial import.** A Cloudflare Workflow pages through the repository's open issues, skips pull requests, and upserts each issue and binding in a step per page. The Workflow instance ID is the `team_repository.id`, so starting it twice is a no-op. Workflows own retries per the repository's orchestration rules. On success the row moves to `ready`. On failure it moves to `failed` and the team settings screen offers a retry that starts a new instance.

**New and changed issues.** The #236 webhook route gains `issues.opened`, `issues.transferred`, `issues.assigned`, `issues.unassigned`, `issues.labeled`, and `issues.unlabeled`. An `opened` event for a linked repository creates the Garden issue and binding through the same upsert as the import. Events for unlinked repositories return 200 and do nothing, as #236 already does for skips.

**Unlink a repository.** Deleting `team_repository` stops new imports. Existing Garden issues and their bindings stay, because people may have commented on them or started runs.

## 6. Prerequisites

- **#196** gives one installation-token path with classified errors. The import Workflow and the repository picker use it.
- **#170** stores each member's GitHub user ID. Assignee and author matching read it.
- **#236** owns signature verification and the webhook route. Its four listed fixes land first: lifecycle-routed status changes, realtime events after commit, `X-GitHub-Delivery` replay protection, and the migration renumber.
- **GitHub App configuration.** The app needs Issues read access and the Issues and Issue comment webhook events. These are set in GitHub's UI and cannot be checked from the repository, so an owner confirms them before release.

## 7. Verification

- Integration tests for linking, import paging, upsert idempotency (same issue imported twice gives one row), `opened` on linked and unlinked repositories, assignee matching with and without a member mapping, and status mapping.
- A Workflow test that a second start with the same instance ID does not import twice.
- End to end against the Garden repository in a dev workspace: link the repository, see open issues on the Garden team board, open a new GitHub issue and see it appear, close it and see it move to `done`.

## 8. Open decisions

- **Team board visibility.** Today a team member sees only team issues assigned to them (`apps/web/src/lib/server/issue-access.ts`). An imported board is useless to a team that cannot see it. The recommendation is that every team member sees the whole team board, decided before engineering onboarding.
- **Invitation to team.** Accepting a workspace invitation adds nobody to a team. The recommendation is an optional team on the invitation, added when it is accepted.
- **Closed issues on import.** The proposal imports open issues only. Importing recently closed issues would give history but clutter the `done` column.
