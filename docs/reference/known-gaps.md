---
title: Known gaps
description: The register of open Garden gaps, with the tracking issue, priority, and code evidence for each one.
status: current
owner: "@Umoren"
last_reviewed: 2026-11-10
---

This register lists gaps that are open in the code today. Each row names the code that shows the gap. Ideas that are not scheduled are on the [roadmap](../concepts/product/roadmap.md), not here.

FLO ids are Linear issues. The GitHub issues that tracked some of these gaps (#27, #28, #31, #32, #33, and #34) were closed on 2026-10-05. The rows below stay open because the code still shows the gap.

## Open gaps

| Area | Issue | Gap | Priority | Evidence | Last verified |
| --- | --- | --- | --- | --- | --- |
| Auth | Security remediation | Prove on the server that roles without permission cannot change permissions. A static test checks that every mutating route calls a permission check, but no test exercises each role against each route. Exploit details follow `SECURITY.md`. | Critical | `apps/web/src/routes/api/-authorization.test.ts` | 2026-11-03 |
| Auth | FLO-30 | Garden checks workspace access in application code, but no test suite proves that one workspace cannot reach another through every product surface. | High | `resolveWorkspaceId` in `apps/web/src/lib/server/control-plane.ts` | 2026-11-03 |
| Auth | None | The chat agent's `read_run` tool finds an issue run by issue number anywhere in the workspace and ignores Team visibility, so a chat owner outside a Team can read that Team issue's run state. The other chat issue tools apply the Team rule. | High | `resolveIssueRun` in `packages/agent-runtime/src/chat-sub-agent-tools.ts` | 2026-11-09 |
| Teams | None | The chat agent's `assign_issue` tool lets a Team member assign a Team issue to anyone. The web `PUT` handler limits a member to assigning Team issues to themselves. | Medium | `assignIssueFromChat` in `packages/agent-runtime/src/chat-sub-agent-tools.ts` | 2026-11-09 |
| Teams | None | A normal Team member sees only Team issues assigned to them, so a Team board filled from a linked GitHub repository shows most members almost nothing. Owners, admins, and the Team owner see the whole board. | High | `teamIssueVisibilityCondition` in `apps/web/src/lib/server/issue-access.ts` | 2026-11-07 |
| Connectors | None | GitHub issue sync creates a new Garden issue when an issue is transferred to another linked repository, because the transferred issue gets a new repository and number. The original Garden issue stays on its board. | Low | `githubWebhookIssueCandidate` in `apps/web/src/lib/server/github-issue-sync.ts` | 2026-11-07 |
| Runs | FLO-31 | Prove in staging that issue and automation runs survive the full lifecycle through `RunWorkflow`: start, wait, resume after eviction, cancel, failure, recovery, and duplicate-start prevention. Integration tests cover duplicate-start and start-failure handling in the service; the staging run is still missing. | High | `packages/agent-runtime/src/run-workflow.ts`, `packages/server/src/issues/start-issue-run.integration.test.ts` | 2026-11-11 |
| Infrastructure | FLO-32 | No smoke check covers the issue-run and automation-run lifecycles or chat message sends against staging, because those checks write data. Read-only checks exist: `pnpm smoke` covers health, sign-in, webhook signature rejection, the session guard, and, with a session cookie, the user, workspace, issue, automation, Org Brain, and chat thread lists. | Medium | `scripts/smoke.mjs`; `docs/guides/operate/deploy.md` (Run the smoke suite) | 2026-11-11 |
| Connectors | None | Capability catalog sync runs only on events: OAuth callback, connection actions, GitHub setup, and the internal sync endpoint. No scheduled job checks drift against upstream `tools/list`. The `0 */12 * * *` cron runs only the issue-run reconciler. | High | `apps/web/src/lib/server/capability-sync.ts`, `scheduled` in `apps/web/src/server.ts` | 2026-11-03 |
| Connectors | None | Scoped Executor MCP sessions phases 2 to 4 are not done: transport proof, connector cleanup, and the Executor v2 evaluation. See [the decision record](../decisions/2026-10-scoped-executor-mcp-sessions.md). | High | `apps/web/src/lib/server/executor-engine/mcp.ts` | 2026-11-03 |
| Connectors | None | Deployed Workers get no Discord credentials. `alchemy.run.ts` binds the GitHub and Slack values but none of the `DISCORD_*` values, so the Discord install and bot calls receive empty strings on staging and production. | High | `optionalPlainBindings` and `optionalSecretBindings` in `alchemy.run.ts` | 2026-11-03 |
| Connectors | None | `propose_agent` records `connector_requirements`, but approving the proposal does not turn them into permission grants. | Medium | `packages/agent-runtime/src/agent-tools/propose-agent.ts` | 2026-11-03 |
| Connectors | None | MCP session state is split between Postgres and a warm cache in each Durable Object. Cleanup on agent archive, issue-run terminal states, and workspace deletion is incomplete. | Medium | `packages/agent-runtime/src/runtime-mcp-controller.ts` | 2026-11-03 |
| Automations | FLO-38 | The `queue` concurrency policy is in `automationConcurrencyPolicyValues`, but `parseConcurrencyPolicy` accepts only `skip` and `replace`. Build queue semantics or remove `queue`. | Medium | `packages/db/src/schema/automation-values.ts`, `packages/agent-runtime/src/automation-trigger-do.ts` | 2026-11-03 |
| Automations | FLO-38 | `webhook` and `api` are trigger kinds, but no route receives them. Authentication, replay protection, idempotency, and attribution are not defined. | Medium | `automationTriggerKindValues` in `packages/db/src/schema/automation-values.ts` | 2026-11-03 |
| Automations | None | Automation runs have no waiting states. Issue runs have `waiting_for_input` and `waiting_for_approval`. | Medium | `automationRunStatusValues` in `packages/db/src/schema/automation-values.ts` | 2026-11-03 |
| Runtime | FLO-37 | No stored prompt and config snapshots, no shared failure taxonomy, no secret-safe traces across chat, issues, and automations, and no regression evals. | Medium | `packages/agent-runtime/src/run-sub-agent-base.ts` | 2026-11-03 |
| Product | FLO-34 | New testers need a shorter path from sign-up to a useful agent action, and clear recovery for failed runs, expired sessions, invitations, and reconnects. | Medium | `apps/web/src/features/auth`, `apps/web/src/features/issues` | 2026-11-03 |
| Connectors | None | No connector audit UI. `tool_call_audit` rows are written but have no "Recent activity" view. | Low | `packages/db/src/schema/audit.ts` | 2026-11-03 |
| Runtime | None | Browser and web retrieval tools exist only for automation runs. Chat and issue runs do not get `createBrowserTools`. | Low | `packages/agent-runtime/src/automation-run-sub-agent.ts` | 2026-11-03 |
| Runtime | None | The Think and Shell workspace and the Sandbox container `/workspace` are separate stores with no sync between them. | Low | `packages/agent-runtime/src/sandbox-tools.ts`. See [Execution runtimes](../concepts/architecture/execution-runtimes.md). | 2026-11-03 |
| Teams | None | People added as initial members when a Team is created do not hear that Team's realtime board events until their socket reconnects. `POST /api/teams` publishes only `team:created`, and the hub refreshes a socket's Team list from `team_member:added`, `team_member:removed`, and `team:deleted`. | Low | `applyRealtimeProfileUpdate` in `packages/agent-runtime/src/realtime-audience.ts`, `apps/web/src/routes/api/teams.ts` | 2026-11-07 |
| Auth | v2+ | No enterprise SSO (SAML or Okta) and no roles beyond owner, admin, and member. | Deferred | `packages/db/src/schema/auth.ts` | 2026-11-03 |

For the realtime boundary, see [Realtime](../concepts/architecture/realtime.md).

## Add or close a row

- To add a row, name the code that shows the gap in **Evidence** and set **Last verified** to today. A gap without code evidence is a roadmap item.
- To close a row, delete it in the pull request that merges the fix, and name the test or code that proves the fix in the pull request. Closing an issue without that proof does not close the row.
- When you check a row and it is still open, update **Last verified**.
- Keep one row per gap. If two issues track the same gap, put both ids in one row.
