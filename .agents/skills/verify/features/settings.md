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
10. On Team, create a Team with a name and one member. Expect the "A new team has been added" toast and a new card with its member count. Use the card menu's Add team member and Delete, and select a card. Expect `/settings/user-management/teams/$teamId` with the Team pill active and the Team's name. Reload it and expect the same page.
11. As a workspace member, open `/settings/user-management/teams`. Expect a redirect to `/settings/user-management/members` and the member list without pills.

## Profile section

1. Open `/settings/profile` as a password user. Expect Identity, Sign-in, Linked identities and Login sessions cards on the grey container, with the workspace role badge.
2. Select Edit name. Expect Save disabled until the name changes. Cancel discards the edit. Save closes the dialog, updates the card and persists after reload.
3. Select Change password. Enter a mismatched confirmation, then expect "Passwords do not match" and a disabled submit. Change the password with matching values, then expect the dialog to close and other sessions to be signed out when that option is checked.
4. Sign in with a Google-only account. Expect no Password row.
5. Sign in from a second browser. Expect the current device first with "This device", and the other session with its OS, browser and a sign-out button. Sign it out, then expect the row removed.
6. At phone width, expect the sessions table to scroll horizontally inside its card without page overflow.

## Preferences section

1. Open `/settings/preferences`. Expect one card with Appearance and Developer sections, and the Theme trigger showing the current theme with its icon.
2. Open the Theme dropdown and choose each of Light, Dark and System. Expect the page to switch mode at once, the trigger to follow, and the choice to persist after reload.
3. Toggle Debug mode on, then open an agent chat tab. Expect the debug drawer. Toggle it off and expect the drawer gone.
4. Open the Settings modal. Expect its Appearance and Developer tabs to show the same theme and Debug mode state.
5. At 375px wide, expect rows to fit without horizontal overflow.

## General section

1. Open `/settings/general` as a workspace admin or owner. Expect a General card with Name, Description, Context, the Context hint and the slug, then a tinted Danger zone card.
2. Edit a field. Expect Save changes and Reset. Reset restores the saved values and hides both. Clearing the name disables Save. Save shows a success toast, updates the workspace name in the sidebar and persists after reload.
3. Sign in as a member. Expect disabled fields and "Only admins and owners can edit workspace settings." at the top of the card.
4. Select Leave workspace. Expect the confirmation dialog. Cancel keeps the workspace. Confirm removes access.
5. At 768 and 375 widths, expect bordered cards with no grey container, the Danger zone button below its text on phones, and no page-level horizontal overflow.
