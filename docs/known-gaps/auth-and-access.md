# Auth & Access

## Gaps

| Gap | Source | Severity |
|-----|--------|----------|
| Better Auth origin checks disabled (`disableOriginCheck: true`) | `apps/web/src/lib/auth/instance.ts:331` | **Critical before ship** |
| CSRF/origin posture needs a final ship review. The app relies on same-site cookies and Better Auth behavior, but the custom API transport does not currently send an `X-CSRF-Token` header. | `apps/web/src/lib/api/transport.ts` | **Critical before ship** |
| Workspace isolation is application-enforced, not DB-level RLS | `docs/core/technical.md` sec. 11: Neon serverless driver doesn't support session-level config | Medium (by design, but a risk surface) |

## Done

| Item | Evidence |
|------|----------|
| Workspace membership validation | `resolveWorkspaceId()` validates user membership via WHERE clauses (`apps/web/src/lib/server/control-plane.ts:31-58`) |

## Deferred

| Feature | Target |
|---------|--------|
| Enterprise SSO (SAML/Okta) | v2+ |
| RBAC beyond owner/admin/member | v2+ |

## Code TODOs

```
apps/web/src/lib/auth/instance.ts:330
  // TODO: Re-enable Better Auth origin checks before shipping.
```
