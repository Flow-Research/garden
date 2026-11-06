---
title: GitHub webhooks keep linked Garden issues current
description: How signed GitHub App webhooks update Garden issues and comments that are already linked to a GitHub issue, and how replays and late deliveries are handled.
status: current
owner: "@Umoren"
last_reviewed: 2026-11-06
---

Related issue: [#161](https://github.com/Flow-Research/garden/issues/161). Pull request: [#236](https://github.com/Flow-Research/garden/pull/236).

## What the feature does

A Garden issue can be linked to a GitHub issue through an `issue_source_binding` row. When someone edits, closes, reopens, or comments on that GitHub issue, the Garden GitHub App receives a webhook and updates the linked Garden issue. Team boards show the change without a refresh, and a close from GitHub has the same effects as a close in Garden.

## Why it works this way

**One lifecycle path.** A status change from GitHub goes through `applyIssueMutationSideEffects`, the helper that `PUT /api/issues/$id` also calls. A close archives the issue's inbox items, cancels live agent runs, and publishes `issue:updated`. An earlier draft wrote `issue.status` directly, which left runs going and inbox items open after a GitHub close. Keep a single helper so the two paths cannot drift apart.

**Effects run after commit.** The webhook writes the ledger row and the issue or comment change in one transaction. Lifecycle effects and realtime events run only after that transaction commits. Clients refetch when the realtime event arrives, so an event sent before commit would make them read old data.

**A delivery ledger guards against replays and late deliveries.** HMAC proves that GitHub sent a delivery. It does not prove that the delivery is new or current. The `github_webhook_delivery` table has one row for each `X-GitHub-Delivery` id:

- A redelivered id hits the unique index and returns `duplicate` without writing anything.
- Each row stores an order marker, which is GitHub's `updated_at` for the issue or comment in milliseconds. The marker is stored per order scope: one scope for the issue's title, body, and state, and one scope for each comment. A delivery is `stale` when an applied delivery in its scope has a later marker. It is also stale when its scope has already applied a `deleted` action, so a late edit cannot bring back a deleted comment.
- Stale deliveries are recorded too, so a redelivery of a stale delivery is a duplicate.
- The binding row is locked `FOR UPDATE` before the ledger check, so two deliveries for one linked issue cannot race.
- If the apply step fails, the transaction rolls back the ledger row with it, so GitHub's redelivery can succeed.

A marker column on `issue_source_binding` was rejected. Comments need their own order streams, and replay detection needs every delivery id, not only the latest one.

**Bot senders are skipped.** Deliveries from `sender.type = Bot` are recorded but not applied, so Garden's own GitHub writes do not echo back into Garden.

## Scope

In scope:

- Verifying `X-Hub-Signature-256` against the raw body with `GITHUB_WEBHOOK_SECRET`.
- `issues.edited`, which syncs title and body. `issues.closed` sets the status to `done`, and `issues.reopened` sets it to `todo`.
- `issue_comment.created`, `edited`, and `deleted`, stored as connector comments with `author_type = 'connector'` and no Garden author id.
- Replay and ordering protection through `github_webhook_delivery`.

Out of scope:

- Creating Garden issues from GitHub issues. Only issues that are already linked sync.
- The UI that links a Garden issue to a GitHub issue.
- Mapping GitHub users to Garden members.
- Sending Garden changes back to GitHub.
- Waking agents on inbound GitHub comments.

## What the user sees

1. Someone closes a linked issue on GitHub.
2. The Garden issue moves to Done on the Team board for every connected viewer. Inbox items for the issue are archived, and any live agent run on it is cancelled.
3. A GitHub comment appears on the Garden issue timeline with the label `GitHub · @login`. Edits and deletes on GitHub update or remove it.
4. A delivery for an unlinked issue, an unknown installation, a replay, or a stale event is acknowledged with HTTP 200 and changes nothing.

## Where it lives

- The route is `POST /api/github/webhook` in `apps/web/src/routes/api/github/webhook.ts`.
- Signature verification is `verifyGitHubWebhookSignature` in `apps/web/src/lib/server/github-webhook.ts`.
- Payload parsing and binding lookup are in `apps/web/src/lib/server/github-webhook-resolve.ts`.
- The ledger transaction is `processGitHubWebhookDelivery` in `apps/web/src/lib/server/github-webhook-delivery.ts`.
- Issue and comment writes are `applyGitHubWebhookIssueUpdate` and `applyGitHubWebhookComment` in `apps/web/src/lib/server/github-webhook-apply.ts`.
- Lifecycle effects and the realtime publish are in `apps/web/src/lib/server/issue-mutation-effects.ts`.
- The tables are `github_webhook_delivery` in `packages/db/src/schema/github.ts`, and `issue_comment.external_comment_id` and `issue_comment.metadata` in `packages/db/src/schema/issues.ts`. Migration `0064` creates them.

## Data and permissions

The route needs no Garden session. The GitHub signature is the only credential, and an empty `GITHUB_WEBHOOK_SECRET` never authorizes a delivery. The installation id selects the workspace through `github_app_installation`, and a disconnected installation is ignored. The route writes only the linked issue's title, description, and status, the issue's connector comments, the binding's `last_synced_at`, and ledger rows. Ledger rows are deleted when their binding is deleted.

## How to verify it

- `pnpm --filter @garden/web exec vitest run src/routes/api/github/-webhook.integration.test.ts` runs the route against a real Postgres container. It covers lifecycle effects on close, a replayed delivery id, a stale delivery, a redelivery after a failed apply, comment events after commit, and comment delete ordering.
- For a manual check, link a staging issue to a GitHub issue, close it on GitHub, and confirm that the Team board moves the card without a refresh. Then use **Redeliver** in the GitHub App's advanced settings and confirm that the response body says `duplicate`.

## Gaps and follow-up

- The order marker compares GitHub timestamps only. A GitHub edit that is delivered after a newer Garden edit still overwrites the Garden edit.
- GitHub timestamps have one-second resolution. Two edits in the same second that arrive out of order are both applied, in arrival order.
- A GitHub close with `state_reason = not_planned` sets the status to `done`, not `cancelled`.
- Nothing prunes `github_webhook_delivery`. Rows grow with delivery volume until their binding is deleted.
