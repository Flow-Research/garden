# GitHub issue sync

## Sub-features

- A Team owner or workspace admin links a GitHub repository from the Team's **Repositories** tab.
- Linking imports the repository's open issues onto the Team board. Pull requests are skipped.
- A new GitHub issue on a linked repository appears on the board, assigned to the member whose GitHub account matches.
- Closing the GitHub issue moves the card to Done, or to Cancelled when it was closed as not planned.
- A failed import shows **Retry import**. **Unlink** keeps imported issues.
- Renaming the repository on GitHub keeps one Garden issue per GitHub issue and moves the binding to the new name.

## How to get to it (user POV)

1. Connect the GitHub App under Connections for a dev workspace. Grant it the Garden repository.
2. As an owner or admin, link your member row to your GitHub account from Settings > Members.
3. Open `/teams/<teamId>?tab=repositories`. Select **Link repository**, pick `Flow-Research/garden`, and confirm.
4. The row shows **Import queued**, then **Importing issues…**, then **Synced**. The **Issues** tab lists the repository's open issues.
5. Open a GitHub issue assigned to yourself. Within seconds it appears on the board, assigned to you, without a refresh.
6. Close it on GitHub. The card moves to Done.

## Driving it with the Garden verification workflow

Run the route and UI tests first:

- `pnpm --filter @garden/web exec vitest run src/routes/api/teams/-team-repositories.integration.test.ts src/routes/api/github/-webhook.integration.test.ts` (needs Docker for the test database)
- `pnpm --filter @garden/web exec vitest run src/features/teams/components/team-repositories-panel.test.tsx`

Then drive steps 3 to 6 in a browser against `pnpm dev`. Webhooks need a public URL that reaches `POST /api/github/webhook`, such as a tunnel set as the App's webhook URL.

## Gotchas

- The App must subscribe to the Issues webhook event and hold Issues read access. Without them, the import works but new issues never arrive.
- Assignment needs `member.github_user_id`. An unlinked member's GitHub assignments leave the issue unassigned.
- A normal Team member sees only issues assigned to them, so check the full board as an owner or admin.
