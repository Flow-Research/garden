# Signup workspace landing

**Status:** current

**Last updated:** 2026-11-03

**Related issue:** [#208](https://github.com/Flow-Research/garden/issues/208)

## Outcome

After a fresh signup (or invite accept), Garden opens the correct workspace and
keeps that choice in the Better Auth session so reloads do not land on a
different org or the empty create-workspace screen.

## Scope and non-goals

### In scope

- Auth bootstrap preferred-workspace selection and `setActiveOrganization`
- Local recovery when create-workspace succeeds but session setActive fails
- Invite accept redirect with `workspace_id` (already implemented; retested as
  a dependency)

### Out of scope

- Full onboarding to first agent action (FLO-34)
- Navigation performance / loader flicker (#213)
- Invite email delivery / resend UX polish beyond existing members-tab resend

## User behavior

1. New user signs up with no memberships → sees "Create a workspace".
2. User creates a workspace → shell opens that workspace; session active org
   matches it.
3. Hard reload → same workspace; session still has that active org.
4. Invite accept → redirect to `/home?workspace_id=…` and that workspace is
   active.
5. If setActive fails after create → shell still opens the new workspace
   locally and shows an error toast (not the empty setup screen).

## System boundary

- `apps/web/src/lib/server/auth-bootstrap.ts` — preferred id + session persist
- `apps/web/src/lib/workspace/mutations.ts` — create-workspace client recovery
- `apps/web/src/routes/_authenticated/invitations/$id.tsx` — invite redirect
- Better Auth organization plugin (`setActiveOrganization` / `listOrganizations`)

## Data and permissions

Reads the signed-in session and organization memberships. Writes
`auth_session.active_organization_id` through Better Auth when bootstrap
selects a workspace that is not already active. No elevated permissions beyond
the signed-in user.

## Design decisions

- Preference order: `workspace_id` query → session active org → first
  membership. Never leave preferred null while memberships exist.
- Persist every bootstrap selection that differs from the session active org,
  not only deep-link selections.
- Create-workspace must not leave a first-time user on the setup screen when
  the org row already exists.

## Verification

- Unit: `apps/web/src/lib/server/auth-bootstrap.test.ts`
- Unit: `apps/web/src/lib/workspace/create-workspace.test.tsx`
- Manual: fresh signup → create workspace → clear/reload with missing active
  org → session should regain the preferred workspace after bootstrap

## Gaps and follow-up

- Invite email + resend end-to-end not re-proved in this change (`INCONCLUSIVE`
  without mail delivery).
- Multi-workspace "which first membership" order follows Better Auth's
  `listOrganizations` order; URL/`workspace_id` remains the explicit override.
