# Teams admin

## Sub-features

- Settings shows a **Teams** entry under the workspace section to workspace owners and admins only.
- Clicking **Teams** closes Settings, then opens `/teams`.
- Settings reopens on the last selected tab.
- `/teams` shows owners and admins the summary cards and Team grid. It has no **Manage Teams** button.
- Members see only their Teams and no management actions.
- Team detail keeps its tab in `?tab=`. An unknown value falls back to **Members**.
- `/teams` shows owners and admins an **Invites** section with **Team owners can invite people to their Team** and **Default team for new members**.
- An invite sent with Teams from **Settings › Members** adds the invitee to those Teams on accept. With no Team picked, the default Team applies.

## How to get to it (user POV)

1. Sign in as a workspace owner or admin. Open Settings from the account menu.
2. Under the workspace name, check for **Teams** with an arrow icon. Click it.
3. Settings closes and the URL becomes `/teams`. The page shows **Total Members** and the Team cards.
4. Open Settings again. It opens on the tab you last used, not on **Account**.
5. Sign in as a normal member and open Settings. There is no **Teams** entry.
6. As the member, open `/teams`. You see a Team selector, not the admin grid.
7. Open `/teams/<teamId>?tab=nonsense`. The **Members** tab is selected.
8. As the owner, open `/teams`. Under **Invites**, set **Default team for new members** to a Team, reload, and check it stays set.
9. Open Settings › Members, enter a new email, pick a Team in the Team picker, and click **Invite**.
10. Accept the invite as that email in a private window. Open `/teams`. The picked Team is listed.

## Driving it with the Garden verification workflow

Run the unit and route tests first:

- `pnpm --filter @garden/web exec vitest run src/features/settings src/features/teams`
- `pnpm --filter @garden/web exec vitest run src/routes/api/teams` (needs the test database)
- `pnpm --filter @garden/web exec vitest run 'src/routes/api/workspaces/$id/-invitation-teams.integration.test.ts'` (needs the test database)

Then drive the user path in a browser against `pnpm dev`. Use two accounts in the same workspace: one owner or admin, one member.

## Gotchas

- The Teams entry stays hidden until the workspace member list loads. On a cold dev server, wait before deciding it is missing.
- The entry is a button, not a tab, so it is outside the Settings tab list. Find it by role `button` and name `Teams`.
