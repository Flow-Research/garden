# Garden Roadmap — Beta / Soft Launch

**Horizon:** small-user beta and dogfood testing
**Focus:** stability, resilience, and confidence over new surface area

## Goal

Garden should survive real use by a small beta group without data leaks, stuck runs, silent failures, or confusing recovery paths. Product can stay narrow; it cannot feel fragile.

## P0 — must land before beta

1. **Ship-safety gates**
   - ✅ Better Auth origin and CSRF checks restored and covered by focused tests.
   - FLO-30 — add workspace-isolation regression coverage across routes, agent RPC, inbox, approvals, documents, and attachments.
   - Keep risky-tool approval paths fail-closed when audit or write operations fail.

2. **Run resilience**
   - FLO-31 — prove issue and automation runs start, wait, resume, cancel, fail, and recover cleanly through `RunWorkflow` in staging.
   - Ensure terminal states never leave stuck `running` rows, duplicate starts, orphaned active runs, or hidden failure reasons.
   - Keep Workflows as recovery boundary; no second queue or transcript-repair layer.

3. **Connector reliability**
   - Track connector health, cleanup, and catalog sync in connector-specific issues and docs.

4. **Operational confidence**
   - FLO-32 — add `/api/health` and beta smoke coverage for login/workspace, chat, issue run, automation run, and document artifacts.
   - ✅ PostHog captures client and Worker failures.
   - ✅ `alchemy.run.ts` defines Cloudflare and Neon staging resources.

## P1 — beta quality

- FLO-34 — polish onboarding and failed-run recovery paths.
- ✅ FLO-35 — existing-thread-document picker shipped.
- FLO-36 — add reverse issue-chat breadcrumbs and multi-issue links.
- FLO-37 — add prompt snapshots, secret-safe tracing, failure taxonomy, and regression evals.
- FLO-38 — harden automation trigger contracts and either implement or remove queue concurrency support.

## Deferred until evidence

- Workspace-wide realtime bus; current mounted chat streams and bounded polling/refetch are acceptable until beta shows pain.
- Parent-backed shared memory, files, MCP state, cross-chat search, or a Workspace/container bridge.
- Workspace-level artifact tabs and Review Grid.
- Visual runtime, charts, and rendered widgets.
- Broader connector marketplace.
- Pricing and billing polish.

## Anti-priorities

- Do not add issue-backed automation compatibility.
- Do not add queue dispatch between `AgentDO` and `RunWorkflow`.
- Do not collapse chats into one mutable Think session.
- Do not build app-wide realtime before measured need.
- Do not treat Sandbox `/workspace` and Think/Shell `Workspace` as shared storage without an explicit bridge.

## Beta readiness checklist

- [x] Better Auth origin and CSRF validation enabled.
- [ ] Workspace-isolation coverage complete.
- [ ] Core smoke tests pass in CI and staging.
- [ ] Runs have visible, recoverable terminal states.
- [ ] Connector failures are explainable and recoverable.
- [ ] Approval/audit paths are trustworthy for risky tools.
- [ ] Tester can complete: connect tool → chat → create issue → agent run → approve action → review output.
