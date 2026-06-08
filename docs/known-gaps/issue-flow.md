# Issue Flow

Core issue-run runtime has shipped. This file tracks remaining gaps against the current codebase, not the old slice plan.

## Current implementation

| Item | Evidence |
| --- | --- |
| Issue schema and run ledger | `packages/db/src/schema/issues.ts` (`issue`, `issue_run`, `issue_run_event`, `issue_work_product`, `issue_source_binding`) |
| Run statuses and trigger sources | `packages/db/src/schema/issue-values.ts` |
| Start/cancel/list run services | `packages/core/issues/run-service.ts` |
| Run orchestration | `AgentDO.startIssueRunWorkflow`, `AgentDO.executeRunTurn`, `RunWorkflow` in `packages/agent-runtime/src` |
| Issue Think facet | `packages/agent-runtime/src/issue-run-sub-agent.ts` |
| Issue tools | `packages/agent-runtime/src/agent-tools/`, `createChatSubAgentTools()` |
| Chat issue tools | `packages/agent-runtime/src/chat-sub-agent-tools.ts` (`create_issue`, `read_issue`, `list_issues`, `post_issue_comment`, `read_run`, `propose_agent`) |
| Work products and apply flow | `apps/web/src/lib/server/work-products.ts`, `packages/db/src/schema/issues.ts` |
| Active run/event polling | `apps/web/src/lib/issues/queries.ts` (`refetchInterval: 2000` while active) |
| Issue UI | `apps/web/src/features/issues/components` |
| Inbox computation | `apps/web/src/lib/server/inbox-compute.ts` |

## Done: do not rebuild

| Item | Evidence |
| --- | --- |
| Per-agent Durable Object topology with issue facets | `packages/agent-runtime/src/agent-do.ts`, `IssueRunSubAgent` keyed by issue id |
| Workflow-backed issue runs | `packages/core/issues/run-service.ts`, `packages/agent-runtime/src/run-workflow.ts` |
| Run-level timeout and cancellation | `agent.run_timeout_sec`, `issue_run.cancel_requested_at`, `IssueRunSubAgent` watchdog logic |
| Source binding and source reads | `packages/core/issues/source-binding.ts`, `packages/agent-runtime/src/agent-tools/read-source.ts` |
| Work product system | `issue_work_product` schema + `apps/web/src/lib/server/work-products.ts` |
| Cost/usage attribution | `issue_run.usage_json`, runtime usage accumulation in `IssueRunSubAgent` |
| Computed inbox | `apps/web/src/lib/server/inbox-compute.ts`, `inbox_dismissal` schema |
| Chat-primary issue link | `chat_thread.primary_issue_id`, `/api/chat/threads/:id/primary-issue`, chat title bar issue pill |
| Open chat from issue | issue detail header action creates/opens an agent chat for that issue |
| Issue mention links in chat | `MentionAwareAnchor`, issue mention card, base prompt reference instructions |
| Contextual composer/status-style agent entries | issue detail components under `apps/web/src/features/issues/components` |
| Inbox self-comment exclusion | `apps/web/src/lib/server/inbox-compute.ts` includes agent comments and non-self user comments, then filters to relevant mentions/owned issues |
| Permission request inbox workspace scoping | `apps/web/src/lib/server/inbox-compute.ts` joins `permission_request` through `agent.workspace_id` before surfacing approvals |
| SQL mention matching | `commentMentionsUserSql()` uses JSON containment against `issue_comment.mentions`; `issue_comment_mentions_gin` supports the query |

## Implementation gaps

| Gap | Severity | Notes / evidence |
| --- | --- | --- |
| Reverse source-chat breadcrumb is missing. | Medium | `chat_thread.primary_issue_id` points chat → issue, but there is no `issue.source_chat_thread_id` or `chat_thread_issue` join for issue → originating chat breadcrumb. |
| Issue Interaction skill is runtime-bundled but not necessarily visible as a normal workspace `skill` row. | Low | `packages/agent-runtime/src/skills/issue-interaction/SKILL.md` is loaded by runtime; seed if product wants it in picker/library UI. |
| Multi-issue chat anchoring is not modeled. | Medium | Current `chat_thread.primary_issue_id` supports one primary issue. Reusable issue chat agents need a join table such as `chat_thread_issue`. |
| Workspace-wide realtime is absent. | Medium | Issue run UI polls; see `docs/known-gaps/realtime-sync.md`. |

## Deferred product work

| Feature | Why deferred |
| --- | --- |
| Recurrence picker UI | Runtime has automations now; issue recurrence should be product-driven, not inherited from old plan. |
| Bulk operations toolbar | Single-issue ops cover current workflow. |
| Saved filter views | Useful once workspaces have larger issue volume. |
| Rich editable agent-proposal approval form | Static approval card covers current flow. |
| Agent inbox/workload view | Needs stronger multi-agent product demand. |
| Capacity/backpressure controls | Do when measured contention appears. |
| Sub-agent / `reports_to` cascade semantics | Schema exists, runtime semantics not needed for MVP. |
| Bulk external import | Agent-driven source binding handles one issue at a time. |

## Historical docs

- `docs/features/issue-flow-plan.md` is now a code map/current architecture note, not an implementation source for old slices.
- `docs/features/issue-flow-rollout-plan.md` is a historical rollout summary.
- Current orchestration rules live in `docs/features/agent-runtime-rearchitecture.md`.
