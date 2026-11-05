# Teams admin

## Sub-features

- Settings shows a **Teams** entry under the workspace section to workspace owners and admins only.
- Clicking **Teams** closes Settings, then opens `/teams`.
- Settings reopens on the last selected tab.
- `/teams` shows owners and admins the summary cards and Team grid. It has no **Manage Teams** button.
- Members see only their Teams and no management actions.
- Team detail keeps its tab in `?tab=`. An unknown value falls back to **Members**.
- Team detail's actions menu opens **Agent policy** for workspace managers and the Team owner. Managers edit and save; the Team owner sees it read-only.
- Unbacked design controls (Chats, Home, Delete projects, Manage billing, Read locked files, Deploy changes, Create documents, Team role, Admin Policy) render disabled with **Coming soon**.
- A Team policy removes blocked tools from the agent and makes approval-required connector calls wait for the Team owner.

## How to get to it (user POV)

1. Sign in as a workspace owner or admin. Open Settings from the account menu.
2. Under the workspace name, check for **Teams** with an arrow icon. Click it.
3. Settings closes and the URL becomes `/teams`. The page shows **Total Members** and the Team cards.
4. Open Settings again. It opens on the tab you last used, not on **Account**.
5. Sign in as a normal member and open Settings. There is no **Teams** entry.
6. As the member, open `/teams`. You see a Team selector, not the admin grid.
7. Open `/teams/<teamId>?tab=nonsense`. The **Members** tab is selected.
8. As the admin, open a Team, click the **⋯** Team actions button, then **Agent policy**. A side sheet opens on **Agent access**.
9. Switch **Knowledge** off and click **Save changes**. The sheet closes with "Agent policy saved". Reopen it: Knowledge stays off.
10. Check the **Admin Policy** tab and the Chats, Home, and restriction rows: each is disabled with a **Coming soon** badge.
11. Make the member the Team owner, sign in as them, and open **Agent policy**. Every control is disabled and the sheet says only workspace admins can change it.
12. Set **Write** to **Approval required**, then, as a Team member, ask the agent to run a connector write such as a GitHub comment. The call waits, and the Team owner's Inbox shows the approval. The owner can approve it.

## Driving it with the Garden verification workflow

Run the unit and route tests first:

- `pnpm --filter @garden/web exec vitest run src/features/settings src/features/teams`
- `pnpm --filter @garden/web exec vitest run src/routes/api/teams src/routes/api/permission-requests` (needs Docker for the test database)
- `pnpm --filter @garden/agent-runtime exec vitest run src/chat-tools.test.ts src/runtime-mcp-controller.team-approval.test.ts`
- `pnpm --filter @garden/core exec vitest run src/teams`

Then drive the user path in a browser against `pnpm dev`. Use two accounts in the same workspace: one owner or admin, one member.

## Gotchas

- The Teams entry stays hidden until the workspace member list loads. On a cold dev server, wait before deciding it is missing.
- The entry is a button, not a tab, so it is outside the Settings tab list. Find it by role `button` and name `Teams`.
- The agent policy query loads only when the sheet opens. A slow first open shows "Loading agent policy…" before the tabs.
- Connector access lists Garden's connector registry, not every Executor integration the workspace installed.
