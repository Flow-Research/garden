---
title: Settings page rollout
description: The routed Settings shell, its existing functional sections, and the separate modal entry during design rollout.
status: current
owner: "@Umoren"
last_reviewed: 2026-11-18
---

Settings has an authenticated page at `/settings` for direct-link review during the staging rollout. Existing account and workspace menu entries still open the Settings modal. The page is not linked from application navigation yet.

## Page shell

The page follows the supplied All settings design: heading and description, horizontal section navigation with icons and an active underline, then a rounded secondary-background content container. Navigation scrolls horizontally on narrow screens. Colors use Garden semantic tokens so the shell supports both themes. Each section places white `SettingsPanel` cards on that container.

`/settings` redirects to `/settings/profile`. Section links preserve browser history and support direct entry and reload. The authenticated app layout owns session and workspace access.

| Section | URL | Existing content reused |
| --- | --- | --- |
| Profile | `/settings/profile` | Redesigned; see [Profile](#profile) |
| User Management | `/settings/user-management` | Workspace members and invitations |
| Preferences | `/settings/preferences` | Appearance and theme selection |
| General | `/settings/general` | Workspace settings |

User Management, Preferences and General reuse the same components, queries and mutations as the modal. Their content redesigns are separate changes. Notifications has no tab or route until its behavior is implemented. This shell adds no new account operations, APIs or permissions.

## Profile

The Profile section follows the new profile design as a guide and keeps every account control the modal offers. It has four cards:

- **Identity.** Avatar tile (click to upload), name, the user's role in the active workspace, and member-since date. **Edit name** opens a dialog with the Preferred name field. Save stays disabled until the name changes, and Cancel discards the edit.
- **Sign-in.** Email with its verification state. A Password row with **Change password** opens a dialog for current, new and confirmed password, plus the option to sign out other sessions. The row is hidden when the account has no `credential` provider, such as Google-only sign-up, and while linked accounts load. The dialog states Better Auth's enforced rule: at least 8 characters.
- **Linked identities.** The existing GitHub identity and Google connection sections.
- **Login sessions.** A table of active Better Auth sessions with operating system, browser, last activity and status. `ua-parser-js` reads the stored user agent. The current device is listed first. Each other session can be signed out individually or together, and the card keeps Sign out of this device.

The modal still renders the earlier `AccountTab`. Both read the same session and linked-account queries from `features/settings/account-queries.ts`.

Design elements without backend support are not shown: email change, two-factor authentication (app or SMS), session IP address and location, and signed-out session history. Better Auth reads the client IP only from `x-forwarded-for` unless `advanced.ipAddress.ipAddressHeaders` is set, and Garden does not set it, so stored session IPs are empty. Add them only with the matching Better Auth configuration or API.

Teams remains at `/teams`. Moving Teams, adding User Management sub-tabs, implementing the remaining designs, and switching menu entries from the modal to this page are follow-up work. The modal's Developer and platform-specific tabs remain in the modal.

## Verification

See the [Settings verification map](../../../.agents/skills/verify/features/settings.md) for direct-link, history, responsive and modal-entry checks.
