---
title: Settings page rollout
description: The routed Settings shell, its sections, User Management's Members and Team sub-tabs, and the separate modal entry during design rollout.
status: current
owner: "@Umoren"
last_reviewed: 2026-11-18
---

Settings has an authenticated page at `/settings` for direct-link review during the staging rollout. Existing account and workspace menu entries still open the Settings modal. The page is not linked from application navigation yet.

## Page shell

The page follows the supplied All settings design: heading and description, horizontal section navigation with icons and an active underline, then a rounded secondary-background content container. Profile, Preferences and General place their content on a primary-surface card inside it. Navigation scrolls horizontally on narrow screens. Colors use Garden semantic tokens so the shell supports both themes.

`/settings` redirects to `/settings/profile`. Section links preserve browser history and support direct entry and reload. The authenticated app layout owns session and workspace access.

| Section | URL | Existing content reused |
| --- | --- | --- |
| Profile | `/settings/profile` | Account profile, password, sessions and linked identities |
| User Management | `/settings/user-management/members`, `/settings/user-management/teams` | Workspace members and invitations; Team management for owners and admins |
| Preferences | `/settings/preferences` | Appearance and theme selection |
| General | `/settings/general` | Workspace settings |

These sections reuse the same components, queries and mutations as the modal and the Teams page. Notifications has no tab or route until its behavior is implemented. Settings adds no new account operations, APIs or permissions.

## User Management

User Management has Members and Team sub-tabs, shown as pills, each with its own path. `/settings/user-management` redirects to `/settings/user-management/members`.

| Page | URL |
| --- | --- |
| Members | `/settings/user-management/members` |
| Team list | `/settings/user-management/teams` |
| Team detail | `/settings/user-management/teams/$teamId` |

- **Members** keeps every existing workspace member control: invite with role and Teams, role changes, removal, GitHub identity linking, and pending invitation resend and revoke.
- **Team** is visible only to workspace owners and admins, because creating, deleting and staffing Teams needs the `teamManage` permission. Others see Members only; Team paths redirect them to Members. It shows the same Team management panel as `/teams`: Create a Team, the Team card grid with member counts, and the card menu's Add team member and Delete. A Team card opens the Settings Team detail page, which shows only the Team's name and description until its design is implemented. Team cards on `/teams` still open `/teams/$teamId`. The default Team for new members stays on `/teams` only.

The design also shows Roles and Guests sub-tabs. Workspace roles are the fixed owner, admin and member set and Garden has no guest access, so neither sub-tab exists until the backend supports it.

Teams also remains at `/teams` with its member view and detail pages. Implementing the remaining section designs and switching menu entries from the modal to this page are follow-up work. The modal's Developer and platform-specific tabs remain in the modal.

## Verification

See the [Settings verification map](../../../.agents/skills/verify/features/settings.md) for direct-link, history, responsive and modal-entry checks.
