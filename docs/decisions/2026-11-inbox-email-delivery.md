---
title: Store email delivery state with inbox items
description: Queue new workspace notification emails through the existing inbox ledger.
status: decision
owner: "@Umoren"
last_reviewed: 2026-11-10
---

[#335](https://github.com/Flow-Research/garden/issues/335) requires Resend emails
for mentions and new inbox items. Writers live in both web routes and agent tools.
The previous assignment-only sender covered one route and had no durable retry.

Store a typed delivery state on `inbox_item`, defaulting to pending for new rows.
A minute cron drains it. This creates the delivery record atomically with the
notification across every writer, without passing provider credentials through
database helpers. Existing rows become skipped during migration.

Direct calls from each writer would duplicate provider logic and lose failed
sends. A separate queue would require coordinating two writes for each inbox
creation. The existing Postgres ledger already owns the record that needs email.

The first delivery attempt commits its payload before calling Resend. Concurrent
and repeated calls use the same payload and per-row key. Resend's
[idempotency lifetime](https://resend.com/docs/dashboard/emails/idempotency-keys)
is 24 hours, so ambiguous attempts older than that become failed rather than
risking another delivery. Permanent provider rejections also become failed.

Delivery checks current workspace membership and Team visibility. Chat threads
remain owner-only, so chat mention notices omit private content and link to inbox.
See [email notifications](../concepts/features/email-notifications.md) for behavior
and verification limits.
