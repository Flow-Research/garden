# Deferred

Things explicitly pushed out of current scope. Cross-checked against code on 2026-05-24.

## Later product/runtime work

- **Knowledge graph / relationship layer.** Useful once connector data is flowing broadly; not needed for current issue/chat/automation loops.
- **In-flow skill recommender.** Needs stronger skill usage telemetry and memory signals.
- **Memory synthesis pipeline.** Current chat prompt has foundation/agent/workspace/skills. Shared user/agent memory should be parent-backed or separately modeled, not inferred from thread sessions.
- **Workspace-wide realtime bus.** No current `BroadcastHub`/`WorkspaceRealtimeAgent` binding or publisher exists. Use polling/refetch plus chat streams until product need justifies it.
- **Slack-native assistants.** Requires stable runtime across Slack invocation surfaces.
- **Headless mode + mobile approvals.** Requires push notifications and mobile approval UX.
- **Agent skill marketplace.** Current skills are workspace-scoped.
- **Browser automation as a user-facing agent capability.** Current runtime focuses on typed MCP connectors, workspace/document tools, codemode, and Cloudflare Sandbox.
- **Workspace ↔ container filesystem sync.** Think/Shell `Workspace` and Cloudflare Sandbox `/workspace` are separate stores; bridge explicitly before promising shared files.
- **BTCA-backed reference codebase search.** Local `refs/` exist; grounded multi-repo search remains workflow tooling.
- **Multi-board governance / nested org hierarchies.** Current tenancy is workspace/company.
- **Deep budget/provider finance ledger.** Lightweight approval and audit surfaces exist; provider-level budgets are later.
- **Automatic invalidation for out-of-band DB changes.** Garden API write paths can refresh state; direct DB edits need a versioned invalidation or realtime signal later.
- **Visual runtime.** HTML/SVG/chart rendering system is a target in `system-spec.md`, not a current runtime.
- **Review Grid.** Depends on document artifact maturity.
- **Workspace-level artifact tabs.** Documents are currently thread/workspace-state scoped.

## No longer deferred / now present

- **Scheduled automations.** Implemented as `automation`, `automation_trigger`, `automation_run`, `AutomationTriggerDO`, and `RunWorkflow`-backed execution.
- **Sandboxed/code execution paths.** Codemode `execute` and Cloudflare Sandbox tools exist, with separate storage semantics.
- **Document artifact subsystem.** Document/version/edit tables, tools, routes, preview, tracked changes, and citations exist.
- **FlexLayout workspace panels.** Implemented in `apps/web/src/components/shell/workspace-dock.tsx`.

## v2+ enterprise

- Enterprise SSO (SAML/Okta).
- On-prem/self-host.
- RBAC beyond owner/admin/member.
- Audit exports/compliance packaging.

## Explicit non-goals

- Replacing terminal coding agents or IDE copilots.
- Zapier-scope connector catalog.
- Chat-window-only product.
- Dev-only tool pretending to be general.
- Git-backed skill distribution.
- Custom thread persistence below Think.
- Treating container `/workspace` as the same store as Think/Shell `Workspace` before an explicit bridge exists.

## Open questions

- Pricing model.
- Default trust posture for connector grants (`auto | allow | ask`).
- Shared memory scope and storage owner.
- Workspace-level document artifact UX.
- Which connector/work-entry paths matter most at launch.
