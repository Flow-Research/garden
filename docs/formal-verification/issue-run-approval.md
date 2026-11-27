---
title: Formal verification plan for issue runs and connector approvals
description: Proposed model and proof checks for issue run control and connector approval.
status: proposed
owner: '@Umoren'
last_reviewed: 2026-11-27
---

# Issue run and approval verification plan

This plan defines a bounded model of issue run control and connector approval.
It does not claim that Garden satisfies the candidate rules. FLO-31 tracks the
related staging proof for the run lifecycle. The owner must decide any change
to approval reuse before a product fix is planned.

## Source boundaries

- `packages/server/src/issues/run-service.ts` creates run rows and sends
  Workflow resume and cancel events.
- `packages/agent-runtime/src/run-workflow.ts` owns durable turns, waits,
  control events, and terminal reporting.
- `packages/agent-runtime/src/agent-do.ts` starts the Workflow. Its instance ID
  is the run ID.
- `packages/agent-runtime/src/issue-run-sub-agent.ts` checks live run status
  before a tool call.
- `packages/agent-runtime/src/run-sub-agent-base.ts` checks cancellation at
  turn boundaries and reads the agent's approval overrides.
- `packages/agent-runtime/src/runtime-mcp-controller.ts` checks connector
  approval and matches canonical arguments.
- `packages/db/src/schema/capabilities.ts` defines approval rows.
- `apps/web/src/lib/server/issue-run-reconciler.ts` denies stale requests and fails matching waiting runs.
- `apps/web/src/routes/api/permission-requests/$id/resolve.ts` checks the
  actor's authority and resolves connector approvals through
  `apps/web/src/lib/server/permission-request.ts`.

Read [the run engine](../concepts/architecture/run-engine.md),
[permissions](../concepts/features/permissions.md), and
[known gaps](../reference/known-gaps.md) before mapping model actions to code.

## Current behavior and decisions

An issue run uses `queued`, `running`, `waiting_for_input`,
`waiting_for_approval`, `succeeded`, `failed`, `cancelled`, and `blocked`.
The last four are terminal for issue runs. A Workflow waits on `run-control`
while approval is outstanding. A resume event starts another turn. A cancel
event closes the run. A turn or Workflow failure can also close a waiting run
as `failed`.

An approval row uses `pending`, `approved`, or `denied`. It has an `expires_at`
column, but the connector approval creation, resolution, and lookup paths do
not set or enforce that timestamp. The reconciler separately denies pending connector writes more than 24 hours after `requested_at`. It records `approval_stale` on matching waiting runs. Track the database result and the waiting Workflow separately.

The connector runtime first matches an approval by agent, capability, tool call
ID, and canonical arguments. It also reuses a recent approved request for the
same agent, capability, and canonical arguments, even when the run or tool call
ID differs. This is the current approval reuse rule. A rule that requires the
same run and tool call for every approval conflicts with that rule. The owner
must decide whether to retain bounded reuse or require call-scoped approval.
Until then, the model must check current reuse as a separate path and label
strict run binding as a proposed property, not a verified invariant.

The agent's `approval_overrides` can auto-approve `send_external` and
`destructive` risk classes. The runtime also allows calls through an effective
grant whose trust level is not `ask`. Team approval policy can require approval
despite an override or grant. Model these as explicit policy inputs read for the
acting agent at decision time, with the run and capability attached to the
decision. Do not use an unconstrained auto-approval switch.

## Model actions

Use these explicit run edges. `terminal` means no later turn or tool action:

```text
queued -> running
queued -> failed | cancelled
running -> waiting_for_approval | waiting_for_input
running -> succeeded | failed | cancelled | blocked
waiting_for_approval -> failed | cancelled
waiting_for_input -> running | failed | cancelled
```

The approval edges are `not_requested -> pending -> approved | denied`.
Include the timer-driven `pending -> denied` transition in the current model. The approval route can record a decision without waking the Workflow. Treat automatic resumption after approval as an unverified transition. The Workflow identity maps one run ID to one instance ID.
Duplicate start requests must not create a second execution path.

Split each sensitive connector action into `ReadRunAndPolicy`,
`ResolveApproval`, and `DispatchTool`. Allow cancellation and approval
resolution between these actions. Record the run status, cancellation request,
agent, capability, tool call ID, canonical arguments, policy source, and
Workflow instance at each step. This exposes the check-then-act race: a guard
can read a live run, then cancellation can land before dispatch. The model
must report whether the current production boundary prevents that dispatch.
Do not make the read and external action one atomic model step unless the code
proves that they are atomic.

## Candidate properties

1. A sensitive action dispatches only when a matching approval, a current
   effective grant, or a current agent override permits it. A Team policy that
   requires approval wins over each automatic path.
2. A tool action cannot dispatch after cancellation takes effect. Test a
   cancellation between the live-run read and dispatch.
3. A terminal run cannot resume or dispatch another action.
4. A denied or still-pending request cannot count as approved.
5. A reused approval must match the current runtime's agent, capability,
   canonical arguments, and reuse window. The run-scoped alternative needs the
   owner decision above.
6. Duplicate Workflow creation for one run ID does not duplicate work.
7. Every resume event reaches only the Workflow instance recorded for that
   run. The web route only writes the approval decision. The verified comment/mention resume path applies to `waiting_for_input`. Model a run that continues to wait after approval.

If a property fails, replay its steps against the named production entry
points. If the model permits an impossible step, correct the model. If code
permits the steps, report the gap without weakening the property.

## Event orders

Check start, approval, and dispatch; start, cancellation, then approval;
approval concurrent with cancellation; and live-run read, cancellation, then
dispatch. Also check denial then retry, duplicate start, agent eviction then
resume, tool submission retry, an approval for arguments A used with arguments
B, and approval reuse across two runs. Include a waiting run that fails before
resume. Race the stale-request sweep against approval. Check what happens if the database closes a run while its Workflow still waits.

## Proof work

Use TLA+ with TLC to explore bounded event orders. Record the model and its
configuration, exact command and tool versions, bounds, assumptions, source
functions, counterexample replays, and the Git commit whose code was checked.
At each later run, compare that commit with the covered files. If any covered
file changed, review the action mapping and rerun the check before claiming
that the result still applies. A passing model proves only its stated bounded
properties.

The pstack `statechart` and `create-formal-verification-skill` helpers are
optional. If installed, record their versions and commands. The model and
replay steps must work without pstack, because pstack is not a Garden runtime
dependency.

Test deliberate broken variants in a disposable checkout. Temporarily remove
the live-run guard, treat pending as approved, skip argument matching, leave a
cancelled Workflow resumable, generate a new Workflow ID for a repeated start,
or bypass a Team-required approval with an override. The checker must find the
matching counterexample. Restore every source file after each variant, verify
the clean diff, and rerun the unchanged model. Never commit a broken variant.

The implementation sequence is to re-read these source files, write the
smallest model, run TLC, replay real counterexamples, test broken variants,
and record the coverage result. Put the runnable check in a separate pull
request. Keep any product fix separate so its behavior and owner decision can
be reviewed on their own.
