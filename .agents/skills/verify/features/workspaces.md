# Workspace memberships

## User paths

1. Sign in to an existing workspace. Open Account, then Workspaces.
2. Create a workspace from that menu. Open Workspaces again without reloading.
   Both workspaces appear and the created workspace is selected.
3. Accept an invitation to another workspace in the same authenticated tab.
   The destination and workspace menu select the invited workspace immediately.
4. Repeat with an invitation opened in a new tab. Initial bootstrap may finish
   before acceptance; the destination must still include the new membership.
5. Keep an existing tab open while accepting another invitation elsewhere.
   Open its workspace menu. Cached rows stay visible while the list refreshes,
   then the accepted membership appears without a reload.
6. Open an expired or wrong-email invitation. Memberships and active selection
   remain unchanged.

## Automated proof

Run the creation, real-router navigation, and account-menu regressions:

```bash
pnpm --filter @garden/web test src/lib/workspace/create-workspace.test.tsx src/lib/workspace/membership-navigation.test.tsx src/components/shell/user-card.test.tsx
```

These tests use real query caches, workspace stores, routing, and menu controls.
Server/API boundaries are replaced with deterministic responses, including an
old list response arriving after creation and bootstrap finishing before invite
acceptance. Database-backed invite authorization is covered separately by
`apps/web/src/lib/server/invitations.integration.test.ts`.

## Browser proof

Use root `pnpm dev` and the parent verification skill. Save screenshots and a
report for both creation and accepted-invitation paths. Record whether a
document reload happened. Never mark a mocked-server test as live-server proof.
