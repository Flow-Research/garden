# Formal verification plan: issue-run lifecycle and approval safety

**Status:** proposed

**Implementation date:** Friday

**Product code changes:** none in this draft

## Goal

Prove that an issue run cannot perform a sensitive external action unless the
run is active and the exact tool call has valid permission.

The first model should cover the interaction between the run lifecycle, the
approval record, and the durable Workflow. It should focus on the event orders
that are hard to cover with ordinary tests.

## Why this target

Garden already has the runtime for issue runs and approvals. The remaining
confidence gap is the behavior across retries, cancellation, approval, and
resumption.

The failure would be serious. Garden could perform an external action after a
user cancels a run, reuse approval for different arguments, or start the same
run twice.

The current staging gap is tracked in the issue-flow documentation as the need
to prove start, wait, resume, cancel, failure, recovery, duplicate-start
prevention, and terminal visibility through `RunWorkflow`.

## Code covered

The model must stay tied to these current boundaries:

- `packages/server/src/issues/run-service.ts` creates, resumes, and cancels
  issue runs.
- `packages/agent-runtime/src/run-workflow.ts` owns durable turns, waits,
  resume, cancellation, and terminal reporting.
- `packages/agent-runtime/src/agent-do.ts` starts the Workflow and delegates
  turns to the issue facet.
- `packages/agent-runtime/src/issue-run-sub-agent.ts` owns the live issue-run
  agent and tool boundary.
- `packages/agent-runtime/src/runtime-mcp-controller.ts` checks connector
  permissions and creates pending approval records.
- `packages/db/src/schema/capabilities.ts` defines the permission request
  record and its `pending`, `approved`, and `denied` states.
- `apps/web/src/routes/api/permission-requests/$id/resolve.ts` authorizes a
  workspace member before resolving a connector approval.

The canonical engine description is
[`docs/core/workflows-engine.md`](../core/workflows-engine.md). The current
issue-flow gaps are in
[`docs/known-gaps/issue-flow.md`](../known-gaps/issue-flow.md).

## Model scope

The first model should contain three small state machines:

### Run state

```text
queued → running → waiting_for_approval → running → succeeded
                                      ↘ cancelled
queued → failed
running → failed
running → cancelled
```

The model may include `waiting_for_input` and `blocked` when the first run
state is correct. It must include every terminal state that the current
Workflow reports.

### Approval state

```text
not_requested → pending → approved
                       ↘ denied
                       ↘ expired
```

The model must bind an approval to the agent, run, capability, tool call ID,
and canonical tool arguments. An approval for one call must not authorize a
different call.

### Workflow identity

One run ID must map to one Workflow instance. Repeating the start request must
not create a second execution path or a second external action.

## Candidate invariants

The model should test these rules:

1. A sensitive tool call cannot execute without an approved matching request or
   an explicit auto-approval policy.
2. A cancelled run cannot execute a later sensitive tool call.
3. A terminal run cannot resume and execute another turn.
4. A denied or expired approval cannot be retried as if it were approved.
5. An approval for one set of arguments cannot authorize a different set of
   arguments.
6. Duplicate Workflow creation for one run ID does not create duplicate work.
7. A waiting run resumes only through the run control path for its own Workflow
   instance.

The implementation must not weaken an invariant to make the model pass. If an
invariant does not match the intended product behavior, record the changed
decision and its source before changing the invariant.

## Event paths to check

The model should explore at least these event orders:

- start → approve → execute;
- start → cancel → approve;
- start → approve → cancel;
- start → deny → retry;
- start → approval expires → resume;
- start → duplicate start;
- start → agent eviction → resume;
- start → tool submission retry → completion;
- start → approval for arguments A → call with arguments B.

For every counterexample, replay the same steps against the real Garden code.
If a model step cannot happen in the code, fix the model. If every step can
happen, report a product bug.

## Tool and proof method

Use TLA+ and the TLC model checker for the first model. This target is about
event order, durable waiting, cancellation, and duplicate execution. A small
model checker is a better fit than a proof assistant for this first question.

Use the pstack `statechart` skill to render each invariant violation as a
shortest path in Garden's terms. Use
`pstack:create-formal-verification-skill` to create the project-local skill
only after the model catches the deliberate broken variants.

The final check must record:

- the TLA+ and configuration files;
- the command and tool versions;
- the state bounds and assumptions;
- the source files and functions covered;
- the commit at which the verification last matched the code;
- the counterexample replay or broken-variant result.

A passing model proves only the stated properties within the stated bounds. It
does not prove the complete Garden runtime, provider behavior, OAuth flow, or
production database.

## Deliberate broken variants

Before calling the check ready, make temporary changes that should break it:

- remove the active-run guard before a tool call;
- allow a pending approval to count as approved;
- remove the argument-match check;
- allow cancellation to leave the Workflow resumable;
- use a new Workflow ID for a repeated start request.

The checker must find each broken rule. Remove the temporary changes after the
check and rerun it.

## Friday implementation plan

1. Re-read the current `dev` versions of the covered files and this plan.
2. Write the smallest TLA+ model that represents the real states and actions.
3. Run TLC and inspect the statechart and report.
4. Replay each counterexample against the real code.
5. Test the deliberate broken variants.
6. Create the project-local formal verification skill with its coverage record
   and sync commit.
7. Open a separate pull request for the runnable formal check. Keep product
   fixes in separate pull requests.

## Out of scope for this draft

- No TLA+ model.
- No TLC or Java setup.
- No formal proof of the complete Garden system.
- No product-code changes.
- No CI merge check.
- No claim that the issue-run lifecycle is already fully proved.
