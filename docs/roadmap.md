# Garden Roadmap — Beta / Soft Launch

**Horizon:** through small-user beta and dogfood testing  
**Focus:** stability, resilience, and confidence over new surface area

## Goal

Garden should survive real use by a small beta group without data leaks, stuck runs, silent connector failures, or confusing recovery paths. The product can still be narrow; it cannot feel fragile.

## P0 — must land before beta

1. **Ship-safety gates**
   - Re-enable Better Auth origin checks.
   - Add workspace-isolation regression tests around routes, agent RPC, inbox, approvals, and document routes.
   - Harden risky-tool approval paths so audit/write failures fail closed.

2. **Run resilience**
   - Prove issue and automation runs can start, wait, resume, cancel, fail, and recover cleanly through `RunWorkflow`.
   - Make terminal states boring: no stuck `running`, duplicate starts, orphaned active runs, or hidden failure reasons.
   - Keep Workflows as the recovery boundary; do not add queues or parallel recovery glue.

3. **Connector reliability**
   - Make connection health obvious: connected, degraded, disconnected, needs reconnect.
   - Tighten MCP session cleanup for archived/deleted chats, terminal runs, archived agents, and workspace deletion.
   - Automate or clearly gate capability catalog sync from upstream `tools/list`.

4. **Observability and smoke tests**
   - Add `/api/health` and basic runtime/connector/run health checks.
   - Wire Sentry or equivalent error capture for Worker + client failures.
   - Add Playwright/Vitest smoke coverage for: login/workspace, chat, issue run, automation run, connector approval, document artifact.
   - Stand up a staging environment with a real Neon branch and Cloudflare preview/deploy path.

## P1 — beta quality wins

1. **Approval + inbox clarity**
   - Approval cards should explain action, risk, connector, target, and result.
   - Inbox should not leak cross-workspace approvals or self-authored noise.

2. **Agent capability awareness**
   - Agents should know which skills, connectors, grants, and callable tools are actually available.
   - Agent proposal/setup should treat connector capability needs as structured data, not prose.

3. **Document loop stability**
   - Replace hidden upload-marker compatibility with request-body document context.
   - Add existing-thread-document picker if beta users rely on docs heavily.
   - Keep artifacts thread-scoped unless workspace-level artifact tabs become a real beta need.

4. **Product polish where it reduces support**
   - Better empty states, reconnect states, failed-run explanations, and recovery CTAs.
   - Onboarding should get testers to one useful agent action quickly.

## P2 — after beta confidence

- Workspace-wide realtime bus, only if polling/refetch feels broken in testing.
- Parent-backed shared memory, files, MCP, or cross-chat search, only for concrete workflows.
- Workspace-level artifact tabs and Review Grid.
- Visual runtime / charts / rendered widgets.
- Broader connector catalog or marketplace.
- Pricing/billing polish.

## Anti-priorities

- Do not add issue-backed automation compatibility.
- Do not add queue dispatch between `AgentDO` and `RunWorkflow`.
- Do not collapse chats into one mutable Think session.
- Do not build broad connector catalog before reliability.
- Do not build app-wide realtime before there is measured pain.
- Do not treat Sandbox `/workspace` and Think/Shell `Workspace` as shared storage without an explicit bridge.

## Beta readiness checklist

- [ ] No critical auth/access gaps remain.
- [ ] Core smoke tests pass in CI and staging.
- [ ] Runs have visible, recoverable terminal states.
- [ ] Connector failures are explainable and recoverable.
- [ ] Approval/audit paths are trustworthy for risky tools.
- [ ] A tester can complete: connect tool → chat → create issue → agent run → approve action → review output.
