---
title: Issues are the shared ledger of work for people and agents
description: How an issue becomes an agent run, where that run's events and outputs live, and how issues connect to chat and the Inbox.
status: current
owner: "@Umoren"
last_reviewed: 2026-11-03
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
4. Each turn runs in `IssueRunSubAgent` (`packages/agent-runtime/src/issue-run-sub-agent.ts`), a Think facet keyed by the issue ID.

Each agent gets at most one live run per issue. `startIssueRun` takes a Postgres advisory lock on the issue ID, then checks for a live run by the same agent before it inserts. A second start for that agent, from a double click, a retry, or another actor, returns `{ kind: 'already_running', runId }` with the existing run, and no second row or Workflow is created. A waiting run is resumed instead (`resumed`). The Workflow instance ID is the run ID, so retrying the runtime start for the same run cannot create a second instance. Different agents can each run on the same issue, for example after a comment mentions them.

If the runtime start fails after the row is written, `markStartFailed` marks the run `failed` with the error, clears `issue.active_run_id`, and appends `issue_run:failed` with reason `workflow_start_failed`. The issue activity timeline shows that event as "agent run failed: <error>", and the Inbox lists the failed run.

`cancelIssueRun` sets `issue_run.cancel_requested_at` and sends a cancel event to the run's Workflow instance, which finalizes the row. Both `POST /api/issues/:id/cancel` and an issue status or assignee change that stops live runs go through it.

A run can outlive its Workflow instance: Workflows may report the instance as not found, or it may already be `complete`, `errored`, or `terminated`. No workflow step will finalize such a run, so `cancelIssueRun` does it directly. It marks the run `cancelled` with `result_json.reason` set to `workflow_instance_missing` or `workflow_instance_terminal`, clears `issue.active_run_id`, appends `issue_run:cancelled`, and returns success. Inbox items derive from live run status, so they clear too. Any other Workflow error fails the cancel and leaves the run unchanged.

The facet also enforces the agent's `run_timeout_sec`. Token and cost usage accumulates in `issue_run.usage_json`. The [run engine](../architecture/run-engine.md) page explains the Workflow loop in full.

## Agents read the source and return work products

An issue can carry source bindings. `packages/server/src/issues/source-binding.ts` attaches and lists them. During a run the agent reads the bound item with the `read_source` tool from `packages/agent-runtime/src/agent-tools/read-source.ts`, so it works from the original pull request, message, or email thread instead of a pasted summary.

The run returns its results as work products. The `create_work_product` and `revise_work_product` tools write `issue_work_product` rows. A work product is a reviewable deliverable such as a report, checklist, plan, or proposed change. `apps/web/src/lib/server/work-products.ts` handles review and apply.

Approving a work product offers two choices, and the review request must name one through the required `close_issue` flag. **Approve** (`close_issue: false`) marks the work product approved and moves an `in_review` issue back to `in_progress`, so the issue stays open and a later `@Garden` comment can start a follow-up run. **Approve and close** (`close_issue: true`) moves an `in_review` issue to `done`. Comment wakeups skip `done` issues, so closing ends agent follow-ups until someone reopens the issue. Both choices leave an issue in any other status unchanged.

## Chat and issues link in both directions

Chat agents can work with issues directly. `createChatSubAgentTools` in `packages/agent-runtime/src/chat-sub-agent-tools.ts` gives a chat agent `create_issue`, `read_issue`, `list_issues`, `post_issue_comment`, `read_run`, and `propose_agent`. `create_issue` accepts an optional `team_id` to file the issue on a Team, and assigns either an agent (`assignee_agent_id`) or a person (`assignee_member`, resolved by name, email, or id the same way `assign_issue` resolves it), never both. The chat owner is the creator, so the issue service applies the Team create rules described in [Teams](teams.md).

A chat thread can also point at one issue. `chat_thread.primary_issue_id` stores the link, `/api/chat/threads/:id/primary-issue` sets it, and the chat title bar shows the issue as a pill. From an issue's detail header you can open an agent chat about that issue. Issue mentions in chat messages render as links through `MentionAwareAnchor` in `apps/web/src/components/ai-elements/message.tsx`.

## The Inbox is computed, not stored

The Inbox has no table of items. `apps/web/src/lib/server/inbox-compute.ts` computes it on each request from approvals, mentions, blockers, and failed runs. It includes agent comments and comments by other users, and leaves out your own. Permission requests join through `agent.workspace_id`, so each workspace sees only its own approvals. Mentions match with `commentMentionsUserSql()`, a JSON containment query on `issue_comment.mentions` backed by the `issue_comment_mentions_gin` index. Dismissing an item writes an `inbox_dismissal` row.

Computing the Inbox keeps it consistent with the data it summarizes. An item disappears when its cause is resolved, with no second record to clean up.

## The UI polls active runs and listens for issue events

While a run is active, the issue queries in `apps/web/src/lib/issues/queries.ts` refetch every two seconds (`refetchInterval: 2000`). Issue and comment changes outside a run reach the client through the workspace realtime hub. `apps/web/src/lib/realtime/invalidation.ts` turns `issue:*` and `comment:*` events into query invalidations. The [realtime](../architecture/realtime.md) page explains why the hub only tells clients to refetch.

The issue UI lives in `apps/web/src/features/issues/components`.

## Automations do not create issues

Automations have their own ledger, `automation_run`. They never create issues as a way to run. See [automations](./automations.md).

Open issue-flow gaps are tracked in [known gaps](../../reference/known-gaps.md).
