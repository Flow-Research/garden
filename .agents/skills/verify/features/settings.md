# Settings page shell

1. Sign in with an existing workspace and open `/settings` directly. Expect `/settings/profile`, the All settings heading, and existing account controls.
2. Select Preferences, change theme, then select General. Expect matching section URLs and existing working controls.
3. Use browser Back and Forward. Expect URL, active underline and content to agree.
4. Reload `/settings/user-management`. Expect `/settings/user-management/members` with members and invitations, without passing through Profile.
5. At phone width, scroll the section navigation horizontally. Expect readable labels, visible focus and no page-level horizontal overflow.
6. Open Settings from the existing account or workspace menu. Expect the original modal, including its existing tabs.
7. Sign out and open `/settings/profile`. Expect the existing login redirect, with no account data rendered.
8. Confirm Notifications is absent and Teams still uses its existing routes.
9. As a workspace owner or admin, open `/settings/user-management`. Expect `/settings/user-management/members` with Members and Team pills, Members active. Select Team. Expect `/settings/user-management/teams`, Create a Team and the Team grid or the No Teams empty state.
10. On Team, create a Team with a name and one member. Expect the "A new team has been added" toast and a new card with its member count. Use the card menu's Add team member and Delete, and select a card. Expect `/settings/user-management/teams/$teamId` with a Teams / name breadcrumb over the Team detail card: Add a team member, Setup Owner, the ⋯ menu and the member table, with no Members / Issues / Repositories pills. Use "See issues" on the Total Assigned Tasks card and expect `/teams/$teamId?tab=issues`. Delete the Team from ⋯ and expect `/settings/user-management/teams`.
11. As an owner or admin on Members, select Add a Team Member. Fill two rows, one with an invalid address, and send. Expect an inline error and nothing sent. Fix it and send; expect one toast and both invitations in the Pending invitations table with resend and revoke. Use a row's ⋯ menu to change a role, link GitHub and remove a member.
12. As a workspace member, open `/settings/user-management/teams`. Expect a redirect to `/settings/user-management/members` and the member list without pills.

## Profile section

1. Open `/settings/profile` as a password user. Expect Identity, Sign-in, Linked identities and Login sessions cards on the grey container, with the workspace role badge.
2. Select Edit name. Expect Save disabled until the name changes. Cancel discards the edit. Save closes the dialog, updates the card and persists after reload.
3. Select Change password. Enter a mismatched confirmation, then expect "Passwords do not match" and a disabled submit. Change the password with matching values, then expect the dialog to close and other sessions to be signed out when that option is checked.
4. Sign in with a Google-only account. Expect no Password row.
5. Sign in from a second browser. Expect the current device first with "This device", and the other session with its OS, browser and a sign-out button. Sign it out, then expect the row removed.
6. At phone width, expect the sessions table to scroll horizontally inside its card without page overflow.

## General section

1. Open `/settings/general` as a workspace admin or owner. Expect a General card with Name, Description, Context, the Context hint and the slug, then a tinted Danger zone card.
2. Edit a field. Expect Save changes and Reset. Reset restores the saved values and hides both. Clearing the name disables Save. Save shows a success toast, updates the workspace name in the sidebar and persists after reload.
3. Sign in as a member. Expect disabled fields and "Only admins and owners can edit workspace settings." at the top of the card.
4. Select Leave workspace. Expect the confirmation dialog. Cancel keeps the workspace. Confirm removes access.
5. At 768 and 375 widths, expect bordered cards with no grey container, the Danger zone button below its text on phones, and no page-level horizontal overflow.

Other section redesigns are outside this scenario.
