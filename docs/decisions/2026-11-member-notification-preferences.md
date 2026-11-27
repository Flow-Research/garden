---
title: Store notification preferences on the workspace member
description: Keep sparse per-category, per-channel opt-outs on the member row and apply them at send time.
status: decision
owner: "@Umoren"
last_reviewed: 2026-11-27
---

[#350](https://github.com/Flow-Research/garden/issues/350) requires email
toggles for mentions, assignments, approvals, and input requests. The toggles
apply to one workspace member. Email is on by default, and the dispatcher must
apply a change to mail that is already queued.

Store the toggles in a `notification_preferences` jsonb column on `member`. The
value holds only opt-outs, in the shape `{ category: { channel: boolean } }`.
The column default `{}` gives every existing and new member the enabled
default, so the migration needs no backfill. The member row is already unique
for each workspace and user, and it is deleted with the workspace.

A separate preference table would need one row for each member, category, and
channel, or a join on every dispatch. The dispatcher already reads the member
row for each item to recheck access, so it reads the preferences in the same
query. This applies an opt-out before every attempt, also for queued items and
retries. Writers do not filter on preferences, so the inbox stays complete.

A new channel adds one value to the Zod channel enum. A missing key reads as
enabled, so stored rows stay valid without a data migration. Inbox types
without a category are not governed by the toggles. See
[email notifications](../concepts/features/email-notifications.md#member-preferences).
