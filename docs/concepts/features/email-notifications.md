---
title: Email notifications
description: How mentions and new inbox items reach workspace members through Resend.
status: current
owner: "@Umoren"
last_reviewed: 2026-11-10
---

Related issue: [#335](https://github.com/Flow-Research/garden/issues/335).

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

Delivery rechecks workspace membership and Team issue visibility. Removed members,
self notifications, and inaccessible issues are skipped. A private chat notice
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
sender. Preferences, digests, and email replies are outside this change.
