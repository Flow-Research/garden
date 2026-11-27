---
title: Issues are the shared ledger of work for people and agents
description: How an issue becomes an agent run, where that run's events and outputs live, and how issues connect to chat and the Inbox.
status: current
owner: '@Umoren'
last_reviewed: 2026-11-24
---

An issue is a unit of work that a person or an agent owns. The UI calls issues Tasks and shows them at `/tasks`. Assigning an issue to an agent turns it into a run: the agent works on the issue in the background, records what it did, and returns reviewable outputs to the same issue.

## An issue and its run are separate records

`packages/db/src/schema/issues.ts` holds the issue model. These tables matter most:

- `issue` stores the work item. Its `status` is one of `todo`, `in_progress`, `in_review`, `done`, `blocked`, or `cancelled`. Its assignee is a user or an agent.
- `issue_run` stores one attempt by an agent to do the work. Its status is one of `queued`, `running`, `waiting_for_input`, `waiting_for_approval`, `succeeded`, `failed`, `cancelled`, or `blocked`.
- `issue_run_event` stores the timeline of a run.
- `issue_work_product` stores the outputs a run produces for review.
- `issue_source_binding` links an issue to the external item it came from, such as a GitHub pull request or a Slack thread.

The value lists live in `packages/db/src/schema/issue-values.ts`.

Keeping the issue apart from its runs lets one issue carry several attempts. A failed run does not erase the issue, and a person can retry or reassign without losing history.

## A run flows from the service to a Think facet through a Workflow

When you assign an issue to an agent and start it, the work passes through four layers:

1. `startIssueRun` in `packages/server/src/issues/run-service.ts` writes the `issue_run` row and asks the agent's runtime to begin.
2. `AgentDO.startIssueRunWorkflow` starts a `RunWorkflow` instance for that run.
3. `RunWorkflow` in `packages/agent-runtime/src/run-workflow.ts` drives the turns. It owns retry, wait, resume, and cancel.
4. Each turn runs in `IssueRunSubAgent` (`packages/agent-runtime/src/issue-run-sub-agent.ts`), a Think facet inside the assigned agent's `AgentDO`, keyed by the issue ID and that agent's context generation on the issue. The generation lives in `issue_agent_context`, one row per issue and agent, and a missing row means generation 0. Generation 0 uses the bare issue ID. A later generation `n` uses `<issueId>:ctx<n>`. `issueRunFacetName` in `packages/agent-runtime/src/issue-agent-context.ts` owns this mapping.

Each agent gets at most one live run per issue. `startIssueRun` takes a Postgres advisory lock on the issue ID, then checks for a live run by the same agent before it inserts. A second start for that agent, from a double click, a retry, or another actor, returns `{ kind: 'already_running', runId }` with the existing run, and no second row or Workflow is created. A waiting run is resumed instead (`resumed`). The Workflow instance ID is the run ID, so retrying the runtime start for the same run cannot create a second instance. Different agents can each run on the same issue, for example after a comment mentions them.

If the runtime start fails after the row is written, `markStartFailed` marks the run `failed` with cause `workflow_start_failed`, clears `issue.active_run_id`, and appends `issue_run:failed`. The timeline, active-run panel, Inbox, and chat transcript use the same failure cause and approved copy. They do not show raw runtime errors.

## Failed runs show a cause and a next step

`@garden/core/runs/failure` defines each issue run failure cause, its title, and its next step. `issue_run.error` stores only the cause code. A failed event stores `{ failure: PublicRunFailure }`. The active-run API returns `failure` instead of the row's `error` text. Runtime diagnostics stay in server logs.

Readers parse older rows and event payloads at the boundary. A known legacy reason maps to its cause. Other legacy text maps to `unknown` and never appears in failure copy. A blocked run returns its agent-authored `blocked_reason` separately from failure data, because `mark_blocked` is a completed resolution rather than a failed run.

| Cause                                                                                              | Title                                                                                                        | Next step                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `subrequest_limit`                                                                                 | The answer got too long for one run.                                                                         | Try again with a narrower request, or split the task.                                                                                                                                 |
| `output_cap_reached`                                                                               | The agent ran out of room before finishing its answer.                                                       | Try again with a narrower request, or split the task.                                                                                                                                 |
| `run_token_budget_exceeded`                                                                        | The run hit its limit of 2 million tokens.                                                                   | Split the task into smaller issues, or narrow its scope, then try again.                                                                                                              |
| `model_unavailable`                                                                                | The AI model didn't respond.                                                                                 | Try again in a few minutes.                                                                                                                                                           |
| `model_retired`                                                                                    | The AI model this agent uses was retired by its provider.                                                    | Ask a workspace admin to choose a new model.                                                                                                                                          |
| `tool_failed`                                                                                      | `{Connector name} failed during the run.` If no name is available: `A connected tool failed during the run.` | Auth: `Reconnect {Connector name} in Connectors.` Permission: `Check what {Connector name} is allowed to access.` Rate limit: `Wait a few minutes and try again.` Other: `Try again.` |
| `turn_timed_out`                                                                                   | The run took too long and was stopped.                                                                       | Try again, or split the task.                                                                                                                                                         |
| `turn_ended_without_resolution`, `no_resolution`                                                   | The agent finished without completing the task or asking a question.                                         | Add more detail to the task and run it again.                                                                                                                                         |
| `no_output`                                                                                        | The automation finished without producing any output.                                                        | Add more detail to the automation's instructions and run it again.                                                                                                                    |
| `brain_output_authority_denied`                                                                    | The agent wasn't allowed to save its results.                                                                | Ask a workspace admin to check the agent's permissions.                                                                                                                               |
| `approval_stale`                                                                                   | The run waited too long for approval and was closed.                                                         | Start the run again when you're ready to approve.                                                                                                                                     |
| `turn_aborted`, `turn_skipped`, `workflow_ended_with_live_run`, `workflow_start_failed`, `unknown` | The run stopped for an unexpected reason.                                                                    | Try again. If it keeps happening, tell your workspace admin.                                                                                                                          |

The Inbox may keep the `Run failed` label. Its body uses the failure title. A timeline row uses `agent run stopped: {title} {next step}`.

`cancelIssueRun` sets `issue_run.cancel_requested_at` and sends a cancel event to the run's Workflow instance, which finalizes the row. Both `POST /api/issues/:id/cancel` and an issue status or assignee change that stops live runs go through it.

A run can outlive its Workflow instance: Workflows may report the instance as not found, or it may already be `complete`, `errored`, or `terminated`. No workflow step will finalize such a run, so `cancelIssueRun` does it directly. It marks the run `cancelled` with `result_json.reason` set to `workflow_instance_missing` or `workflow_instance_terminal`, clears `issue.active_run_id`, appends `issue_run:cancelled`, and returns success. Inbox items derive from live run status, so they clear too. Any other Workflow error fails the cancel and leaves the run unchanged.

A run starts on a fresh agent context when the current facet holds history that Brain permissions cannot verify. The issue's generation increases by one, the old facet keeps its history for review, and the run timeline shows `issue_run:context_reset`. [Permissions](permissions.md#brain-grants-for-issue-and-automation-runs) describes when this happens.

The facet also enforces the agent's `run_timeout_sec`. Token and cost usage accumulates in `issue_run.usage_json`. The [run engine](../architecture/run-engine.md) page explains the Workflow loop in full.

## Agents read the source and return work products

An issue can carry source bindings. `packages/server/src/issues/source-binding.ts` attaches and lists them. During a run the agent reads the bound item with the `read_source` tool from `packages/agent-runtime/src/agent-tools/read-source.ts`, so it works from the original pull request, message, or email thread instead of a pasted summary.

The run returns its results as work products. The `create_work_product` and `revise_work_product` tools write `issue_work_product` rows. A work product is a reviewable deliverable such as a report, checklist, plan, or proposed change. `apps/web/src/lib/server/work-products.ts` handles review and apply. The task page's **Activity** tab shows work-product cards followed by system activity (status changes, run failures); comments and agent replies live in the **Comments** tab, and Activity links to each agent reply.

Approving a work product offers two choices, and the review request must name one through the required `close_issue` flag. **Approve** (`close_issue: false`) marks the work product approved and moves an `in_review` issue back to `in_progress`, so the issue stays open and a later `@Garden` comment can start a follow-up run. **Approve and close** (`close_issue: true`) moves an `in_review` issue to `done`. Comment wakeups skip `done` issues, so closing ends agent follow-ups until someone reopens the issue. Both choices leave an issue in any other status unchanged.

Apply sends an approved work product out of Garden. **Apply** posts the body as a comment on the bound GitHub issue. **Apply as PR** (`action: 'apply_pr'`) turns the body into a repository file. It needs `payload.pr_target`, a typed object (`workProductPrTargetSchema` in `packages/core/src/issues/work-product-pr-target.ts`) with `repository` (`owner/repo`), a repo-relative `path`, and an optional `base_branch` that defaults to `dev`. The agent sets it through `create_work_product`; it lives in the existing `payload` column because only the apply path reads it. The repository must be linked to the issue's Team in `team_repository`, or the request fails before any GitHub call.

The server then reads the head of the base branch, creates `garden/work-product-<id>`, writes the body to the file (updating it when it already exists), and opens a pull request into the base branch. Each call runs through the workspace GitHub App installation, with the approving person as actor, through the same approval gate as the comment path. The PR body fills `.github/pull_request_template.md` so `scripts/verify-pr-contract.mjs` passes, and it says `Closes #N` when the bound GitHub issue is in the same repository, which lets the PR webhook move the board card. Garden records the PR URL and number as `applied_external_url` and `applied_external_id` and appends `issue_run:work_product_applied`. Apply as PR is safe to retry after a partial failure: an existing `garden/work-product-<id>` branch is reused, and an open PR from it is recorded instead of opening a second one. Merging stays a human step on GitHub. The work-product card shows **Apply as PR** next to Apply when a target is set, and **View pull request** afterwards.

Approving a workspace-wide document saves it to Files & Folders. When a `brief`, `plan`, `report`, or `checklist` work product is approved, through either **Approve** or **Approve and close**, the server writes the approved body (the edited body when the reviewer edited it) as `<title-slug>.md` through `saveBrainFileUpload` in `apps/web/src/lib/server/brain-file-upload.ts`. That is the same stage, index, and audit path that `POST /api/brain/files` uses, so the file is owned by the approving person and is indexed and searchable like an upload. `pull_request` and `connector_reply` work products are not saved. There is no manual save control and no folder picker.

Team issue documents stay on the issue because Brain files are readable by all workspace members. A workspace issue saves to the shared folder named after the workspace. Names longer than 50 characters use the shared folder “Approved workspace documents”. If the shared folder does not exist, concurrent approvals in the same workspace create one folder and use it for every document. The file is added to the folder, Garden records `payload.saved_file` (`workProductSavedFileSchema` in `packages/core/src/issues/work-product-saved-file.ts`: file id, name, folder id, content URL, who saved it, when), and it appends `issue_run:work_product_saved_to_files` with the approving person as `actor_user_id`.

Saving preserves `status` and `applied_external_*`, so Apply and Apply as PR stay available. The system save event identifies the file for this work product. When a person approves a revision, Garden updates that file only if the person owns it and still has access to its scope. The file keeps its ID and R2 key. `Brain.replaceFileContent` updates the size and time and marks it for indexing. The run event records `overwritten: true`. If the file was deleted or belongs to another person, Garden saves a copy for the current approver and records its link. A retry uses that approver’s existing copy, including a partial save that has no save event yet. Only an approved work product can be saved.

A failed save does not undo the approval. The approve response carries `files`, which is `{ status: 'saved', ... }`, `{ status: 'skipped' }` for a type that is not saved, or `{ status: 'failed', message }`. On failure the client shows the toast "Approved, but saving to Files failed" with the message, and the run gets an `issue_run:work_product_save_failed` event at level `error`, so the failure stays on the run timeline after the toast is gone. The issue and inbox cards offer Retry saving to Files for unsaved workspace documents after approval, including documents already applied. A retry leaves the approval and issue status intact.

The Markdown file is the source of truth. After a save the card links the file and offers **Markdown** and **Word** downloads. `GET /api/brain/files/$id/docx` renders Word on each request from the stored Markdown with `markdownToDocx` (`packages/agent-runtime/src/documents/markdown-docx.ts`), keeping headings, bullet and numbered lists, tables, and bold, italic, and code text. The .docx is never stored.

## Chat and issues link in both directions

Chat agents can work with issues directly. `createChatSubAgentTools` in `packages/agent-runtime/src/chat-sub-agent-tools.ts` gives a chat agent `create_issue`, `read_issue`, `list_issues`, `post_issue_comment`, `read_run`, and `propose_agent`. `create_issue` accepts an optional `team_id` to file the issue on a Team, and assigns either an agent (`assignee_agent_id`) or a person (`assignee_member`, resolved by name, email, or id the same way `assign_issue` resolves it), never both. The chat owner is the creator, so the issue service applies the Team create rules described in [Teams](teams.md).

A chat thread can also point at one issue. `chat_thread.primary_issue_id` stores the link, `/api/chat/threads/:id/primary-issue` sets it, and the chat title bar shows the issue as a pill. From an issue's detail header you can open an agent chat about that issue. Issue mentions in chat messages render as links through `MentionAwareAnchor` in `apps/web/src/components/ai-elements/message.tsx`.

## The Inbox is computed, not stored

The Inbox has no table of items. `apps/web/src/lib/server/inbox-compute.ts` computes it on each request from approvals, mentions, blockers, and failed runs. It includes agent comments and comments by other users, and leaves out your own. Permission requests join through `agent.workspace_id`, so each workspace sees only its own approvals. Mentions match with `commentMentionsUserSql()`, a JSON containment query on `issue_comment.mentions` backed by the `issue_comment_mentions_gin` index. `matchMentions()` in `packages/server/src/issues/server.ts` fills that column: composer links (`mention://member/<id>`, `mention://user/<id>`, `mention://agent/<id>`) resolve by id, limited to members and active or pending agents of the workspace, and typed `@name` tokens still match by name or email alias. Dismissing an item writes an `inbox_dismissal` row.

Computing the Inbox keeps it consistent with the data it summarizes. An item disappears when its cause is resolved, with no second record to clean up.

## The UI polls active runs and listens for issue events

While a run is active, the issue queries in `apps/web/src/lib/issues/queries.ts` refetch every two seconds (`refetchInterval: 2000`). Issue and comment changes outside a run reach the client through the workspace realtime hub. `apps/web/src/lib/realtime/invalidation.ts` turns `issue:*` and `comment:*` events into query invalidations. The [realtime](../architecture/realtime.md) page explains why the hub only tells clients to refetch.

The issue UI lives in `apps/web/src/features/issues/components`.

## Task detail keeps the history and conversation together

Task detail uses a centered column with an editable title and description. The
column and its loading wrapper shrink to the available width. Long titles wrap
in an auto-sizing text field, and Enter finishes editing. On phones, header
actions use a separate row, conversation metadata wraps, and the properties
sheet fits the viewport with a visible Close button. Status,
priority, and due date are editable badges below the description, alongside
reactions and attachment upload. The header provides **New Sub-task**, the
existing actions menu, and a properties toggle. The properties rail retains
assignee, project, parent task, creation details, and debug usage information.

**Activity** shows work-product cards, then system activity such as status
changes and run failures. Each agent reply also appears there as one
"<agent> replied" row; selecting it opens **Comments** and highlights the reply.
**Comments** shows every comment, agent replies included, with threaded replies,
a count derived from the loaded timeline, and the composer below the thread.
Switching tabs
keeps the top-level comment draft. A comment focus link opens Comments directly.
Subscribers can subscribe or unsubscribe and manage other participants beside
the tabs. The tabs and subscriber controls stick beneath the task header once
scrolled into view, keeping navigation available through a long conversation.

Comment cards place the avatar beside author and time, with the action menu at
the top right. Reactions and Reply sit below the body, followed by an inset
divider. Collapse and expand live in the action menu alongside existing copy,
edit, and delete actions. Comment bodies, metadata, and actions wrap on phones.

Agent runs, questions, approvals, plans, and reviewable outputs stay above the
tabs so either view can reach them. Composer instructions describe an agent run
only when the task is assigned to an agent. Tasks without an agent use a normal
comment composer. Empty activity describes task updates rather than scheduled
automation runs. Meeting cards and other sample content from design mockups are
not task features.

## Automations do not create issues

Automations have their own ledger, `automation_run`. They never create issues as a way to run. See [automations](./automations.md).

Open issue-flow gaps are tracked in [known gaps](../../reference/known-gaps.md).
