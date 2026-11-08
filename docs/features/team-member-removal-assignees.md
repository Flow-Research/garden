# Team member removal and issue assignees

**Status:** current

**Last updated:** 2026-11-04

**Related issue:** [#152](https://github.com/Flow-Research/garden/issues/152)

## Outcome

Removing a user from a Team never leaves open Team issues assigned to that
user. Those issues move to the Team owner so managers and the owner keep
visibility; the removed member cannot retain invisible assigned work.

## Scope and non-goals

### In scope

- `removeTeamMember` reassigns open Team issues for the removed **user** to
  `team.owner_user_id` in the same transaction as the membership delete
- Documenting that behavior for maintainers and API callers
- Regression coverage for remove-with-assignments and remove-with-none

### Out of scope

- Blocking removal while open assignments exist
- Auto-unassign to the Team backlog (no assignee)
- Notifying the owner or removed member
- UI copy that reports how many issues moved (optional follow-up)
- Rewriting assignees when an **agent** membership is removed

## User behavior

1. A manager or Team owner removes a non-owner user member.
2. Membership row is deleted.
3. Any open Team issues (`status` not `done` or `cancelled`) that were assigned
   to that user now have `assignee_type=user` and `assignee_id` = Team owner.
   `team_id` stays the same.
4. Done / cancelled issues keep their previous assignee.
5. Removing a member with no open assigned Team issues only deletes membership.
6. Removing the Team owner still fails with `TEAM_OWNER_REQUIRES_TRANSFER`
   until ownership is transferred.

## System boundary

- `apps/web/src/lib/server/teams.ts` — `removeTeamMember`,
  `reassignOpenTeamIssuesToOwner`
- `DELETE /api/teams/:teamId/members/:membershipId` —
  `apps/web/src/routes/api/teams/$teamId/members/$membershipId.ts`
- Visibility still enforced by `teamIssueVisibilityCondition` in
  `packages/db/src/team-issue-visibility.ts`
- Broader Teams admin surface:
  [Teams](../concepts/features/teams.md)

## Data and permissions

- Reads / writes `team_member` and matching `issue` rows for that Team.
- Requires existing Team manage auth (`requireTeamManage`).
- Does not change workspace roles. Does not invent a Team “lead” role — the
  handoff target is always `team.owner_user_id`.

## Design decisions

- **Chosen #152 option:** reassign open assigned Team issues to the Team owner
  (not block-on-remove, not unassign-to-backlog).
- **Open** means status ∉ `{done, cancelled}` (includes `blocked`,
  `todo`, `in_progress`, `in_review`).
- Reassignment and membership delete share one DB transaction so a failed
  reassign cannot leave a deleted member with stale assignees.
- Activity payload may include `reassigned_issue_count` for ops evidence; API
  response stays `204`.

## Verification

- Integration: remove member with open assigned Team issues → membership gone,
  those issues’ assignee is the Team owner; managers still see them.
- Integration: remove member with no assigned open Team issues → membership
  delete only; other issues unchanged.
- Existing: owner remove still returns `TEAM_OWNER_REQUIRES_TRANSFER`.

Evidence path: `apps/web/src/routes/api/teams/-teams.integration.test.ts`

- `reassigns open Team issues to the owner when removing an assigned member`
- `removes a member with no open assigned Team issues without rewriting issues`
- existing `removes members but blocks removing the owner`

## Gaps and follow-up

- Integration proof: **PASS** —
  `pnpm --filter @garden/web exec vitest run src/routes/api/teams/-teams.integration.test.ts`
  (19 passed; reassign case logged `reassignedIssueCount: 2`).
- No user-facing toast that N issues moved to the owner.
- Agent membership removal does not reassign agent-assigned issues.
