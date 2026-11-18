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

Remaining section redesigns are outside this scenario.
