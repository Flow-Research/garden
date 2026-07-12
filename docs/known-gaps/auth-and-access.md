# Auth & Access

## Active gaps

| Issue | Gap | Evidence | Priority |
| --- | --- | --- | --- |
| FLO-30 | Workspace isolation is application-enforced rather than DB-RLS-backed and lacks one regression suite across routes, agent RPC, inbox, approvals, documents, and attachments. | `resolveWorkspaceId()` and workspace-scoped service queries; `docs/core/technical.md` sec. 11 | High |

## Done

| Item | Evidence |
| --- | --- |
| Better Auth origin and CSRF checks explicitly enabled | `apps/web/src/lib/auth/instance.ts` sets `disableCSRFCheck: false` and `disableOriginCheck: false`; focused tests cover trusted, foreign, missing, and `null` origins. Garden-owned APIs retain their existing cookie policy; no custom global origin middleware is planned. |
| Workspace membership validation | `resolveWorkspaceId()` validates membership through workspace-scoped queries in `apps/web/src/lib/server/control-plane.ts`. |

## Deferred

| Feature | Target |
| --- | --- |
| Enterprise SSO (SAML/Okta) | v2+ |
| RBAC beyond owner/admin/member | v2+ |
