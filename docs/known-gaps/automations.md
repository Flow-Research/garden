# Automations

Automations are a first-class product surface backed by `automation`, `automation_trigger`, and `automation_run`. They run through `AutomationTriggerDO`, `AgentDO`, `RunWorkflow`, and `AutomationRunSubAgent`. This file tracks the remaining gaps, not the older issue-run-based plan.

## Current implementation

| Item | Evidence |
| --- | --- |
| Automation tables | `packages/db/src/schema/automations.ts` |
| Trigger/status/source enums | `packages/db/src/schema/automation-values.ts` |
| Server run service | `packages/server/src/automations/run-service.ts` |
| Web helpers and routes | `apps/web/src/lib/server/automations.ts`, `apps/web/src/routes/api/automations*.ts` |
| Trigger Durable Object | `packages/agent-runtime/src/automation-trigger-do.ts` |
| Runtime facet | `packages/agent-runtime/src/automation-run-sub-agent.ts` |
| Durable execution | `packages/agent-runtime/src/run-workflow.ts` |
| UI | `apps/web/src/features/automations` |

## Active gaps

| Issue | Gap | Priority | Notes / evidence |
| --- | --- | --- | --- |
| FLO-31 | Prove the automation run lifecycle in staging alongside issue runs. | High | Verify start, wait, resume, cancel, failure, recovery, duplicate-start prevention, and terminal state visibility through `RunWorkflow`. |
| FLO-38 | Harden trigger contracts and concurrency. | Medium | Define typed webhook/API authentication, replay protection, idempotency, attribution, and observability. Implement queue semantics end to end or remove `queue` from supported configuration. |

Audit dashboards and richer trigger-editing polish remain deferred until usage demonstrates need.

## Done: do not rebuild

| Item | Evidence |
| --- | --- |
| Automations do not create Garden issues as orchestration. | `automation_run` has its own ledger and `AutomationRunSubAgent` prompt says this is not an issue. |
| Scheduled runs use Agents SDK schedules through `AutomationTriggerDO`. | `AutomationTriggerDO.scheduleAutomationTrigger()` creates one-time schedules for timezone-aware cron. |
| Manual/scheduled runs converge on the same `automation_run` + Workflow path. | `startAutomationRun()`, `AgentDO.startAutomationRunWorkflow`, `RunWorkflow`. |

## Rules

- Do not route automation execution through `issue_run`.
- Do not add Cloudflare Queues between `AgentDO` and `RunWorkflow` without a proven platform gap.
- If an automation needs to create or update issues, do that as explicit domain tool work inside the automation prompt.
