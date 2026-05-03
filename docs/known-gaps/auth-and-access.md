# Auth & Access

## Gaps

| Gap | Source | Severity |
|-----|--------|----------|
| Better Auth origin checks disabled (`disableOriginCheck: true`) | `apps/web/src/lib/auth/instance.ts:278` | **Critical before ship** |
| Workspace isolation is application-enforced, not DB-level RLS | `docs/core/technical.md` sec. 11 — Neon serverless driver doesn't support session-level config | Medium (by design, but a risk surface) |

## Done

| Item | Evidence |
|------|----------|
| CSRF protection | Client reads `accelerate_csrf` cookie and sends `X-CSRF-Token` header (`apps/web/src/lib/api/transport.ts:32-45`) |
| Workspace membership validation | `resolveWorkspaceId()` validates user membership via WHERE clauses (`apps/web/src/lib/server/control-plane.ts:31-58`) |

## Deferred

| Feature | Target |
|---------|--------|
| Enterprise SSO (SAML/Okta) | v2+ |
| RBAC beyond owner/admin/member | v2+ |

## Code TODOs

```
apps/web/src/lib/auth/instance.ts:278
  // TODO: Re-enable Better Auth origin checks before shipping.
```
