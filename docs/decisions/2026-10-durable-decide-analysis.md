---
title: Run Decide analysis in its own Workflow, not inside the chat request
description: Decision record from October 2026 to move Decide analysis into a dedicated durable Workflow and run table, and the chat contract that followed.
status: decision
owner: "@Umoren"
last_reviewed: 2026-11-03
---

**Date:** October 2026. **Outcome:** shipped in PR #242 on 2026-10-30, with the chat contract refined in PRs #250 and #253 on 2026-11-02. The current behavior is described in [Decide](../concepts/features/decide.md).

## Context

The `decide_analyze` call ran inside the live chat MCP request. The MCP handler passed that request's `AbortSignal` to Decide, so a browser or chat disconnect could stop the provider call. Garden stored neither progress nor the final result, so a reconnecting client had nothing to read.

Decide analysis needed its own job lifetime. The chat request had to start the job and return a run ID. A Cloudflare Workflow had to own the provider call. A Postgres run record had to own the product state.

## Decision

Garden added a dedicated `DecideAnalysisWorkflow` binding and a `decide_analysis_run` table. `RunWorkflow` did not gain a Decide branch. `RunWorkflow` owns issue and automation turn loops. Decide needs a single provider call, a different retry policy, and a different result shape.

The implementation took two ideas from the losing candidate: deterministic Workflow instance IDs and conditional terminal transitions.

## Alternatives considered

An arena compared two candidates. A cross-judge scored the separate Workflow 20/25 and the shared Workflow 14/25.

- **Extend `RunWorkflow` with a Decide payload kind.** Fewer bindings, but a third product surface would branch inside the shared Workflow. It would have to understand another ledger, another result shape, and another retry policy. The binding surface would shrink while the Workflow contract grew.
- **Reuse `issue_run` or `automation_run`.** Both tables require product relationships that a chat analysis does not have. Their event and permission semantics would leak into the job.
- **Keep the MCP request open longer.** The browser and the MCP request would still own the provider lifetime. A longer timeout does not survive a disconnect.

The separate Workflow kept provider retry rules, result storage, and chat semantics out of the issue and automation control flow. It also let the provider worker stay in `apps/web`, where the Executor runtime already resolves OAuth.

## Trade-offs accepted

- One more Workflow binding, in exchange for a clear failure boundary.
- The full MCP result stored on the run row, in exchange for a small first implementation. A later result-object store can move large payloads without changing the job API.
- At-least-once provider execution if a Worker crashes after Decide accepts a request and before Garden stores the result. Garden marks that state as uncertain instead of retrying silently. Decide exposes no idempotency key for Garden to use.
- Polling as the reconnect source of truth. Live push can come later without changing the run state model.

## What the first release taught

The first release returned a bare run ID to the model and appended Decide's raw output with `Think.addMessages`. A live test showed the cost. The model had no status tool, so it called `sleep`, started a second paid run, and then redid the analysis in the sandbox. Decide's raw blocks, including session IDs and progress logs, landed in the middle of that turn.

PRs #250 and #253 replaced that behavior with the current chat contract:

- One active run per thread, enforced by a partial unique index.
- Garden, not the model, chooses the Decide session.
- The start turn ends in the step that started the run.
- A status card with fixed copy replaces model narration.
- The answer arrives through a `Think.submitMessages` delivery turn with no active tools.

`Think.saveMessages` was rejected for delivery. It holds the RPC open for the whole model turn, and its `shouldApplyMessages` option is missing from the published `SaveMessagesOptions` type.

A workspace-wide lookup by model tool-call ID was also removed. Tool-call IDs restart in each thread, and the lookup once handed a new chat another chat's failed run.

The timeout changed too. The call first used the MCP SDK's 60-second silence timeout, and a dev run failed with `MCP error -32001: Request timed out` while Decide was likely still working and charging. Decide has no time limit, optional progress events, and no tool to fetch a finished result later. Garden now holds the request open for up to one hour and judges it by total time, not silence.
