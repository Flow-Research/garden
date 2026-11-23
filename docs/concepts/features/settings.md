---
title: Settings page rollout
description: The routed Settings shell, its existing functional sections, and the separate modal entry during design rollout.
status: current
owner: "@Umoren"
last_reviewed: 2026-11-17
---

Settings has an authenticated page at `/settings` for direct-link review during the staging rollout. Existing account and workspace menu entries still open the Settings modal. The page is not linked from application navigation yet.

## Page shell

The page follows the supplied All settings design: heading and description, horizontal section navigation with icons and an active underline, then a rounded secondary-background content container. Navigation scrolls horizontally on narrow screens. Colors use Garden semantic tokens so the shell supports both themes.

`/settings` redirects to `/settings/profile`. Section links preserve browser history and support direct entry and reload. The authenticated app layout owns session and workspace access.

| Section | URL | Existing content reused |
| --- | --- | --- |
| Profile | `/settings/profile` | Account profile, password, sessions and linked identities |
| User Management | `/settings/user-management` | Workspace members and invitations |
| Preferences | `/settings/preferences` | Appearance and theme selection |
| General | `/settings/general` | Workspace settings |

These sections reuse the same components, queries and mutations as the modal. Their content redesigns are separate changes. Notifications has no tab or route until its behavior is implemented. This shell adds no new account operations, APIs or permissions.

Teams remains at `/teams`. Moving Teams, adding User Management sub-tabs, implementing the remaining designs, and switching menu entries from the modal to this page are follow-up work. The modal's Developer and platform-specific tabs remain in the modal.

## Verification

See the [Settings verification map](../../../.agents/skills/verify/features/settings.md) for direct-link, history, responsive and modal-entry checks.
