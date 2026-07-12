# Auth & Access

## Active gaps

| Issue | Gap | Evidence | Priority |
| --- | --- | --- | --- |
| FLO-30 | Workspace isolation is application-enforced rather than DB-RLS-backed and lacks one regression suite across routes, agent RPC, inbox, approvals, documents, and attachments. | `resolveWorkspaceId()` and workspace-scoped service queries; `docs/core/technical.md` sec. 11 | High |
| FLO-33 | Better Auth protects `/api/auth`, but Garden-owned cookie-authenticated mutation routes do not yet share an explicit, tested server-side CSRF/origin contract. | `apps/web/src/lib/api/transport.ts`, `apps/web/src/routes/api` | High |

## Done

| Item | Evidence |
| --- | --- |
| Better Auth origin and CSRF checks explicitly enabled | `apps/web/src/lib/auth/instance.ts` sets `disableCSRFCheck: false` and `disableOriginCheck: false`; focused tests cover trusted, foreign, missing, and `null` origins. |
| Workspace membership validation | `resolveWorkspaceId()` validates membership through workspace-scoped queries in `apps/web/src/lib/server/control-plane.ts`. |

## Deferred

| Feature | Target |
| --- | --- |
| Enterprise SSO (SAML/Okta) | v2+ |
| RBAC beyond owner/admin/member | v2+ |
