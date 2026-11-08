---
title: Automations are their own product surface with their own run ledger
description: How automations are modeled, how a trigger becomes a durable run, which concurrency policies work, and the rules that keep automations apart from issues.
status: current
owner: "@Umoren"
last_reviewed: 2026-11-03
---

An automation is a standing instruction for an agent: a prompt, an assignee agent, and one or more triggers. Each time a trigger fires, Garden records an `automation_run` and runs the agent through the same durable engine that issue runs use. The UI calls automations Workflows and shows them at `/workflows`.

Automations do not create issues to do their work, and they do not run through `issue_run`. That separation is the core design choice. An automation that ran as an issue would add a card to the board on every run and inherit the issue timeline, permissions, and review flow, none of which fit unattended work.

## Three tables hold the automation model

`packages/db/src/schema/automations.ts` defines the tables. The value lists live in `packages/db/src/schema/automation-values.ts`.

- `automation` stores the title, prompt and config, assignee agent, priority, status, concurrency policy, schedule, output, execution and notification config, and counters.
- `automation_trigger` stores one trigger's config.
- `automation_run` stores each execution attempt and its terminal result.

The vocabulary is:

```ts
automation.status: active | paused | archived
automation.concurrencyPolicy: skip | queue | replace
automation_trigger.kind: schedule | webhook | api
automation_run.source: schedule | manual | webhook | api
automation_run.status: pending | queued | running | completed | failed | cancelled | skipped
```

## Every trigger converges on one run path

Runs start in two ways. `AutomationTriggerDO` (`packages/agent-runtime/src/automation-trigger-do.ts`) owns scheduled triggers. Its `scheduleAutomationTrigger` method uses Agents SDK schedules to set one-time alarms for timezone-aware cron expressions, then schedules the next one. Manual, webhook, and API starts call the run service directly.

Both paths reach the same engine:

1. `packages/server/src/automations/run-service.ts` creates the `automation_run` row.
2. `AgentDO.startAutomationRunWorkflow` starts a `RunWorkflow` instance.
3. `RunWorkflow` calls `AgentDO.executeAutomationRunTurn` and `AgentDO.completeAutomationRunTurn` for each turn.
4. The turn runs in `AutomationRunSubAgent` (`packages/agent-runtime/src/automation-run-sub-agent.ts`). Its prompt states that the run is not an issue and must not create a kanban card.

The [run engine](../architecture/run-engine.md) page explains resume, cancel, and the shared status model.

## Only `skip` and `replace` concurrency work today

`AutomationTriggerDO` applies the automation's concurrency policy before it starts the next scheduled run. `skip` is the safe default: a new run is skipped while one is active. `replace` is also accepted. The schema allows `queue`, but `parseConcurrencyPolicy` rejects it with the `unsupported_policy` error "Automation queue concurrency policy is not implemented." Do not expose `queue` in the product until the runtime implements it end to end.

## The code is spread across four packages

| Concern | Path |
| --- | --- |
| Tables | `packages/db/src/schema/automations.ts` |
| Status, source, and trigger values | `packages/db/src/schema/automation-values.ts` |
| Run service | `packages/server/src/automations/run-service.ts` |
| Web helpers and API routes | `apps/web/src/lib/server/automations.ts`, `apps/web/src/routes/api/automations.ts`, `apps/web/src/routes/api/automations/` |
| Trigger Durable Object | `packages/agent-runtime/src/automation-trigger-do.ts` |
| Runtime facet | `packages/agent-runtime/src/automation-run-sub-agent.ts` |
| Parent runtime methods | `startAutomationRunWorkflow`, `executeAutomationRunTurn`, and `completeAutomationRunTurn` in `packages/agent-runtime/src/agent-do.ts` |
| Durable execution | `packages/agent-runtime/src/run-workflow.ts` |
| UI | `apps/web/src/features/automations` |
| Bindings | `AUTOMATION_TRIGGER` and `RUN_WORKFLOW` in `apps/web/wrangler.jsonc` |

## Rules keep automations apart from issues

- Do not create issues as automation orchestration.
- Do not route automation execution through `issue_run`.
- Do not add Cloudflare Queues between `AgentDO` and `RunWorkflow` without a proven platform gap.
- Do not revive the old `execution_mode = create_issue` assumption.
- If an automation must create or update issues, do it as explicit tool work inside the automation's prompt.

Open automation gaps, such as trigger hardening and staging proof of the run lifecycle, are tracked in [known gaps](../../reference/known-gaps.md).
