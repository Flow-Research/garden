# Deferred Features & Open Questions

Documented decisions from `docs/core/DEFERRED.md`, cross-checked against current code. These are not oversights.

## Post-MVP / later

| Feature | Rationale / current state |
|---------|---------------------------|
| Knowledge graph / relationship layer | Nice once connector data flows; not needed day one. |
| In-flow skill recommender | Needs stronger skill/memory usage signals. |
| Memory synthesis pipeline | Current prompt has agent/workspace/skills context, not a shared memory pipeline. |
| Workspace-as-split-panes beyond current FlexLayout panels | FlexLayout panel system exists; richer Glass-style multi-pane workflows can wait. |
| Slack-native assistants | Requires stable runtime across invocation surfaces beyond web. |
| Headless mode + mobile approvals | Requires push notifications and stable mobile approval UX. |
| Agent skill marketplace (cross-workspace) | Day one is workspace-scoped skills. |
| Browser automation as product capability | Current focus is typed connectors, workspace/document tools, codemode, and Sandbox. |
| Runtime Workspace ↔ container sandbox sync | Think/Shell workspace and Cloudflare Sandbox `/workspace` are separate stores; explicit bridge deferred. |
| BTCA-backed reference codebase search | Missing piece is wiring BTCA into repo/team workflow. |
| Multi-board governance / nested orgs | Single workspace/company model remains simpler. |
| Deep budget + approval workflows | Light approval/inbox model exists; finance ledger is later. |
| Automatic prompt/skill invalidation for out-of-band DB changes | Needs versioned invalidation or workspace realtime signal. |
| Workspace-wide realtime bus | No binding/publisher exists; app uses polling/refetch plus chat streams. |
| Visual runtime (HTML/SVG rendering, charts) | System spec target; no renderer exists yet. |
| Browser/web retrieval tools | System spec target; not a core runtime tool yet. |
| Custom category icons | Using current icon set for now. |
| Gamification / mastery badges | No current product pressure. |
| Review Grid (tabular doc-review surface) | Depends on document artifact substrate maturity. |
| Global workspace artifact/document bucket and workspace-level artifact tabs | Document artifacts are currently thread/runtime-owned; `workspace_id` is an access boundary, not a shared artifact home. |

## Already built or in progress, not deferred

| Surface | Evidence |
| --- | --- |
| Scheduled automations | `packages/db/src/schema/automations.ts`, `AutomationTriggerDO`, `automation_run` |
| Sandboxed/code execution paths | `createExecuteTool` usage, `packages/agent-runtime/src/sandbox-tools.ts`, `Sandbox` binding |
| Document artifact subsystem | `packages/db/src/schema/documents.ts`, `packages/agent-runtime/src/documents`, document routes/UI |
| FlexLayout workspace panels | `apps/web/src/components/shell/workspace-dock.tsx` |

## v2+ enterprise

| Feature | Rationale |
|---------|-----------|
| Enterprise SSO (SAML/Okta) | Enterprise-conversion feature. |
| On-prem / self-host | Expensive to factor; avoid unless a deal is on the table. |
| RBAC beyond owner/admin/member | Custom roles, permission grants per-resource. |
| Audit log UI + compliance exports | DB audit records exist; richer surfacing/export is later. |

## Open design questions

- Pricing model: per-user, per-workspace, usage-based, or hybrid?
- Default trust posture: current connector grants use `auto | allow | ask`; product defaults and upgrade nudges still need validation.
- Which external work-entry paths matter at launch beyond manual issues, chat tools, automations, and configured connectors?
- How much shared agent memory and artifact storage should be parent-backed versus explicitly scoped to a thread/run?

## Explicit non-goals

- Replacing terminal coding agents or IDE copilots.
- Zapier-scope connector catalog.
- Chat-window-only product.
- Dev-only tool pretending to be general.
- Git-backed skill distribution.
- Custom thread persistence below Think.
- Treating Cloudflare Sandbox container `/workspace` as the same store as Think/Shell `Workspace` before an explicit sync bridge exists.
