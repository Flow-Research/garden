# Settings page shell

1. Sign in with an existing workspace and open `/settings` directly. Expect `/settings/profile`, the All settings heading, and existing account controls.
2. Select Preferences, change theme, then select General. Expect matching section URLs and existing working controls.
3. Use browser Back and Forward. Expect URL, active underline and content to agree.
4. Reload `/settings/user-management`. Expect members and invitations without passing through Profile.
5. At phone width, scroll the section navigation horizontally. Expect readable labels, visible focus and no page-level horizontal overflow.
6. Open Settings from the existing account or workspace menu. Expect the original modal, including its existing tabs.
7. Sign out and open `/settings/profile`. Expect the existing login redirect, with no account data rendered.
8. Confirm Notifications is absent and Teams still uses its existing routes.

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

Redesigns of the other sections and Teams migration are outside this scenario.
