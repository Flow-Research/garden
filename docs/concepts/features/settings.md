---
title: Settings page rollout
description: The routed Settings shell, its sections, User Management's Members and Team sub-tabs, and the separate modal entry during design rollout.
status: current
owner: '@Umoren'
last_reviewed: 2026-11-23
---

Select **Settings** in the account menu to open the authenticated `/settings` page. The workspace menu opens the Settings modal.

## Page shell

The page follows the supplied All settings design: heading and description, horizontal section navigation with icons and an active underline, then a rounded secondary-background content container. Navigation scrolls horizontally on narrow screens. Colors use Garden semantic tokens so the shell supports both themes. Each section places white `SettingsPanel` cards on that container. Switching sections slides the active underline to the new tab and fades the section content in from the left (`Animate` in `apps/web/src/components/animate.tsx`). Moving between a section's sub-routes does not replay it, and users who prefer reduced motion get the fade without movement.

`/settings` redirects to `/settings/profile`. Section links preserve browser history and support direct entry and reload. The authenticated app layout owns session and workspace access.

| Section         | URL                                                                    | Existing content reused                                                  |
| --------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Profile         | `/settings/profile`                                                    | Redesigned; see [Profile](#profile)                                      |
| User Management | `/settings/user-management/members`, `/settings/user-management/teams` | Workspace members and invitations; Team management for owners and admins |
| Preferences     | `/settings/preferences`                                                | Redesigned; see [Preferences](#preferences)                              |
| General         | `/settings/general`                                                    | Redesigned; see [General](#general)                                      |

User Management uses the existing workspace and Team queries and mutations. Preferences and General use the same stores and mutations as their modal controls. Notifications has no tab or route. Settings adds no new account operations, APIs or permissions.

## Profile

The Profile section follows the new profile design as a guide and keeps every account control the modal offers. It has four cards:

- **Identity.** Avatar tile (click to upload), name, the user's role in the active workspace, and member-since date. **Edit name** opens a dialog with the Preferred name field. Save stays disabled until the name changes, and Cancel discards the edit.
- **Sign-in.** Email with its verification state. A Password row with **Change password** opens a dialog for current, new and confirmed password, plus the option to sign out other sessions. The row is hidden when the account has no `credential` provider, such as Google-only sign-up, and while linked accounts load. If they fail to load, the row shows the error with Retry. The dialog states Better Auth's enforced rule: at least 8 characters.
- **Linked identities.** The existing GitHub identity and Google connection sections.
- **Login sessions.** A table of active Better Auth sessions with operating system, browser, last activity and status. `ua-parser-js` reads the stored user agent. The current device is listed first. Each other session can be signed out individually or together, and the card keeps Sign out of this device.

The modal still renders the earlier `AccountTab`. Both read the same session and linked-account queries from `features/settings/account-queries.ts`.

Design elements without backend support are not shown: email change, two-factor authentication (app or SMS), session IP address and location, and signed-out session history. Better Auth reads the client IP only from `x-forwarded-for` unless `advanced.ipAddress.ipAddressHeaders` is set, and Garden does not set it, so stored session IPs are empty. Add them only with the matching Better Auth configuration or API.

## User Management

User Management has Members and Team sub-tabs, shown as pills, each with its own path. `/settings/user-management` redirects to `/settings/user-management/members`.

| Page        | URL                                       |
| ----------- | ----------------------------------------- |
| Members     | `/settings/user-management/members`       |
| Team list   | `/settings/user-management/teams`         |
| Team detail | `/settings/user-management/teams/$teamId` |

- **Members** follows the Members design: the pills on the left, **Add a Team Member** on the right for owners and admins, and a table with User and Role columns. Each row also shows the member's GitHub identity. Its ⋯ menu keeps the existing controls: role change, GitHub link and unlink, and removal. Pending invitations follow in a second table with resend and revoke. **Add a Team Member** opens a dialog with one row per invitee: email, role (Member or Admin) and the Teams they join on accept. Each row is its own invitation request. Invalid or duplicate addresses stop the whole batch before anything is sent, and rows the server rejects stay in the dialog with their error. The Settings modal's Members tab renders the same component without the pills.
- **Team** is visible only to workspace owners and admins, because creating, deleting and staffing Teams needs the `teamManage` permission. Others see Members only; Team paths redirect them to Members. It shows the same Team management panel as `/teams`: Create a Team, the Team card grid with member counts, and the card menu's Add team member and Delete. A Team card opens the Settings Team detail page: a Teams breadcrumb over the same Team detail card as `/teams/$teamId`, with Add a team member, Setup Owner, the ⋯ menu (View details, Team settings, Copy link, Delete team), and the member table with Agent settings. It shows the Members view only, without the Members, Issues and Repositories pills or the summary card's "See issues" link. Issues and Repositories stay on `/teams/$teamId`. Deleting the Team returns to the Settings Team list. Team cards on `/teams` still open `/teams/$teamId`.

Invite rows are locked while requests are sending. Failed rows become editable when the requests finish. On phones, the invitation dialog puts each email above its role and Team controls. Scroll through the invitees while **Cancel** and **Send invite** stay in view.

The designs also show elements Garden has no backend for, so they are not built:

- **Roles and Guests sub-tabs.** Workspace roles are the fixed owner, admin and member set, and Garden has no guest access.
- **Import Team Member.** There is no bulk import endpoint.
- **Full name on invitations.** Invitations carry only email, role and Teams; the name comes from the invitee's account.
- **Departments column on Members.** The members API does not return each member's Teams.
- **Department Head badge.** The Team detail table labels the Team owner "Team Owner".

## Preferences

The Preferences section is one card with two sections:

- **Appearance.** A Theme row with a dropdown of Light, Dark and System. It calls `next-themes`, so the choice applies to this device only. Until `next-themes` reads the stored choice, the trigger shows no option.
- **Developer.** A Debug mode switch bound to the client-side `useDevSettingsStore`. It shows the agent chat debug drawer on this device.

The modal keeps its separate Appearance and Developer tabs, which read the same theme and store.

Design elements without backend support are not shown: Agent preferences (communication style, proactivity, decision autonomy), Language and time, and Privacy (cookie settings, view history). Garden has no setting, schema or API for them. Notifications is also left out, as above.

Teams also remains at `/teams` with its member view and detail pages. Implementing the remaining section designs and routing the workspace Settings entry to this page are follow-up work. The modal's Developer and platform-specific tabs remain in the modal.

## General

The General section restyles the workspace settings and keeps every control the modal offers. It has two cards:

- **General.** Name, Description and Context fields, with a hint that agents read Context as background. The slug is a read-only row. Save and Reset appear only after a field changes, ignoring leading and trailing spaces. Save is disabled while the name is empty, and it sends trimmed values. A successful save updates the workspace store and the cached workspace list. Unsaved edits are tied to the workspace they were typed in, so switching workspaces discards them. Members who are not admins or owners see the fields disabled, with a note at the top of the card.
- **Danger zone.** Leave workspace, with the existing confirmation. The dialog stays open if leaving fails, so the action can be retried.

The modal still renders the earlier `WorkspaceTab`. Both use `api.updateWorkspace` and `useLeaveWorkspace`.

## Verification

See the [Settings verification map](../../../.agents/skills/verify/features/settings.md) for direct-link, history, responsive and modal-entry checks.
