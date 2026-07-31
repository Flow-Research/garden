# Automation Plan

**Status:** current product/runtime note
**Last reviewed:** 2026-05-24

Automations are a first-class product surface. They own triggers and produce `automation_run` rows. They do not create issues or route through `issue_run` as orchestration.

## Current code map

| Concern | Evidence |
| --- | --- |
| Automation tables | `packages/db/src/schema/automations.ts` |
| Status/source/trigger enums | `packages/db/src/schema/automation-values.ts` |
| Server run service | `packages/server/src/automations/run-service.ts` |
| Web server automation helpers/routes | `apps/web/src/lib/server/automations.ts`, `apps/web/src/routes/api/automations*.ts` |
| Trigger Durable Object | `packages/agent-runtime/src/automation-trigger-do.ts` |
| Runtime facet | `packages/agent-runtime/src/automation-run-sub-agent.ts` |
| Parent runtime RPC | `AgentDO.startAutomationRunWorkflow`, `executeAutomationRunTurn`, `completeAutomationRunTurn` in `packages/agent-runtime/src/agent-do.ts` |
| Durable execution | `packages/agent-runtime/src/run-workflow.ts` |
| UI | `apps/web/src/features/automations` |
| Bindings | `apps/web/wrangler.jsonc` (`AUTOMATION_TRIGGER`, `RUN_WORKFLOW`) |

## Product model

- `automation` stores title, prompt/config, assignee agent, priority, status, concurrency policy, scheduling config, output/execution/notification config, and analytics counters.
- `automation_trigger` stores schedule/webhook/API trigger config.
- `automation_run` stores each execution attempt and terminal result.

Current source/status vocabulary:

```ts
automation.status: active | paused | archived
automation.concurrencyPolicy: skip | queue | replace
automation_trigger.kind: schedule | webhook | api
automation_run.source: schedule | manual | webhook | api
automation_run.status: pending | queued | running | completed | failed | cancelled | skipped
```

## Runtime lifecycle

Automations start through `AutomationTriggerDO` (scheduled) or directly (manual/webhook/API), then converge on the same `automation_run` + `AgentDO` + `RunWorkflow` engine issue runs use. Full turn-by-turn lifecycle, resume/cancel, and status vocabulary: [`docs/core/workflows-engine.md`](../core/workflows-engine.md).

## Concurrency

`AutomationTriggerDO` owns schedule-trigger state and applies the automation's concurrency policy before creating/starting the next run. `skip` is the safe default. `queue` is declared in the schema but should only become product behavior when code implements it end to end.

## Hard rules

- Do not create issues as automation orchestration.
- Do not route automation execution through `issue_run`.
- Do not add CF Queues between `AgentDO` and `RunWorkflow`.
- Do not revive old `execution_mode = create_issue` assumptions.
- If an automation needs to create or edit issues, do that as explicit domain tool work inside the automation prompt/tool call.

## Remaining product gaps

| Gap | Notes |
| --- | --- |
| Rich trigger editing polish | Keep UI aligned with `automation_trigger` schema and `AutomationTriggerDO` scheduling behavior. |
| Queue concurrency behavior | Schema allows `queue`, but product/runtime should not expose it before implementation. |
| Audit/usage surfaces | `automation_run.usage_json`, counters, and detail pages can be expanded into richer analytics. |
| Webhook/API trigger hardening | Token handling, replay/idempotency, and observability should stay code-backed in route docs when expanded. |
