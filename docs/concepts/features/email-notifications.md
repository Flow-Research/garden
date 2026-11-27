---
title: Email notifications
description: How mentions and new inbox items reach workspace members through Resend.
status: current
owner: "@Umoren"
last_reviewed: 2026-11-27
---

Related issues: [#335](https://github.com/Flow-Research/garden/issues/335) and [#350](https://github.com/Flow-Research/garden/issues/350).

## What members receive

Each newly created inbox item queues one email, including assignments, approvals,
requests for input, and explicit member mentions. Description and comment edits
notify newly mentioned recipients without resending to earlier recipients.
Mentions use the editor's stable `mention://member/<user-id>` links. Plain names,
agent mentions, issue links, and `@all` do not send member mention emails.
Self mentions do not create notifications.

Emails link to the issue, or to the workspace inbox when no issue is attached.
Chats remain owner-only. A chat mention creates a generic inbox notice without
copying the private conversation or granting access to it.

## Member preferences

Each workspace member controls email for four categories in Settings. The
categories are mentions, assignments, approvals, and input requests. Email is
on for every category by default, for existing and new members. A member who
belongs to two workspaces has separate settings in each workspace.

| Category | Inbox types |
| --- | --- |
| Mentions | `mentioned` |
| Assignments | `issue_assigned`, `assignee_changed`, `unassigned` |
| Approvals | `review_requested`, `wp_review`, `brain_proposal` |
| Input requests | `waiting_for_input`, `connector_needed` |

An inbox type that is not in this table has no category. The toggles do not
change its delivery, so items such as `new_comment` keep sending email. A
preference controls email only. The inbox item still appears in Garden.

`member.notification_preferences` stores only the opt-outs, in the shape
`{ category: { channel: boolean } }`. A missing key means enabled, so `{}` is
the default. `email` is the only channel today. A future channel, for example
Discord, adds one value to `notificationChannelValues` in
`packages/db/src/schema/notification-preferences.ts`. Stored rows stay valid,
so that change needs no data migration.

`GET` and `PATCH /api/workspaces/$id/notification-preferences` read and change
the settings of the caller only. The server takes the member from the session.
The request body names a category, a channel, and a value, and it cannot name a
member. Users outside the workspace get `403`. One `PATCH` changes one toggle
in one SQL statement, so concurrent toggles do not overwrite each other.

## Delivery and failure

`inbox_item.email_delivery` is the durable delivery record. Every existing inbox
writer queues email through the column default, including agent tools. The web
Worker's minute cron sends pending records through Resend using `RESEND_API_KEY`
and `BETTER_AUTH_URL`. Missing configuration leaves items pending. Provider
failures never fail the action that created the inbox item.

The first attempt stores an immutable recipient and email payload. Retries use
`inbox/<item-id>` as the Resend idempotency key. Attempts stop after Resend's
[24-hour key lifetime](https://resend.com/docs/dashboard/emails/idempotency-keys)
to avoid duplicate mail after an ambiguous send. Delivery state records sent,
skipped, and failed outcomes. Existing inbox records are skipped by the migration
so enabling delivery does not email historical notifications. Updating an inbox
row does not create another email.

Temporary failures keep the item queued. The dispatcher continues to later
items after one message fails. It pauses the batch for rate limits, provider
outages, and credential errors. A credential rejection on the first attempt
returns the item to pending. If an earlier attempt has an unknown outcome, the
24-hour limit still applies during an outage. These items record `failed` when
the limit expires. Permanent message rejections also record `failed`.
Email bodies show mention labels without editor link markup.

Delivery rechecks workspace membership and Team issue visibility. Removed members,
self notifications, and inaccessible issues are skipped. The dispatcher also
reads the preferences of the recipient before each attempt. This includes items
that were queued or retried before the member turned the category off. These
items record `skipped` with the reason `preference_disabled`. If the member turns
the category on again before the next attempt, the item sends. A private chat notice
contains no conversation title or message body. The sender uses the same verified
Garden domain as invitations.

## Ownership and verification

The [control plane](../architecture/how-garden-is-built.mdx) owns delivery state.
`packages/db/src/inbox.ts` writes mentions. The web email dispatcher owns Resend
calls, delivery state transitions, and failure logging. No browser polling is
required to create mention notifications or send email.

See the [verification path](../../../.agents/skills/verify/features/email-notifications.md)
for member actions, permission refusal, and delivery checks. Database integration
tests exercise the real inbox writers and dispatcher with a simulated Resend
boundary. Real mailbox delivery requires a deployed cron and verified Resend
sender. Digests, email replies, and channels other than email are outside this
feature.
