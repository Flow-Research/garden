---
title: Decide analysis runs as a durable background job in chat
description: How a chat request to Decide becomes a Workflow-owned run, how the status card tracks it, and how the answer returns to the thread.
status: current
owner: "@Umoren"
last_reviewed: 2026-11-03
---

Decide is an external analysis service that Garden reaches through Executor. When you ask a chat agent to analyze data with Decide, the analysis can take many minutes. Garden runs it as a background job that outlives the chat request, shows its progress in a status card, and delivers the answer into the thread when it finishes. You can leave the chat while it runs.

The reasons for this design, and the alternatives it beat, are in the decision record [Durable Decide analysis](../../decisions/2026-10-durable-decide-analysis.md).

## Three boundaries own the lifetime of a run

The design holds three boundaries. Passing a browser signal or an OAuth value into the Workflow would break them.

1. The chat MCP request starts the job and returns at once.
2. `DecideAnalysisWorkflow` (`apps/web/src/decide-analysis-workflow.ts`, binding `DECIDE_ANALYSIS_WORKFLOW`) owns the long-running provider call.
3. Executor owns OAuth and the connection to Decide. The Workflow payload holds only identifiers. Executor resolves the saved token inside its own storage.

## The `decide_analysis_run` table is the source of truth

`packages/db/src/schema/decide-analysis.ts` defines `decide_analysis_run`. A row stores the workspace, owner, thread, and agent runtime, the question and input data, the attempt and deterministic `workflow_instance_id`, the latest progress, the provider session ID, the result or error, and the timestamps for cancel request, provider call start, start, completion, and delivery.

A run moves through these states:

```text
queued -> running -> completed
                  -> failed
                  -> cancel_requested -> cancelled
```

Terminal updates are conditional. A late provider result cannot overwrite `cancelled`, `failed`, or `completed`.

## A chat call starts one run per thread

From chat, the model calls `decide_analyze({ question, data })` and gets back `{ run_id, status: "queued" }`. The tool call does not pass the chat request's abort signal to Decide.

`startDecideAnalysis` in `apps/web/src/lib/server/decide-analysis/service.ts` returns `{ kind: "started" | "already_running", snapshot }`. The partial unique index `decide_analysis_run_thread_active_idx` allows one `queued`, `running`, or `cancel_requested` run per thread. A second call while a run is active returns that run and never charges Decide again. A start only ever returns the thread's active run. Model tool-call IDs, such as `functions.tool_executor_decide_analyze:1`, restart in each thread, so the run stores the ID for tracing only.

Chat calls carry trusted `_meta` with the thread ID and the model tool-call ID, and the MCP adapter uses it to create the asynchronous run. A direct caller without that metadata, such as a diagnostic, still gets a synchronous call.

## Garden owns the Decide session

In chat, the model does not pass a `session_id`. A call without `data` reuses the provider session of the thread's latest `completed` run. A call with new `data` starts a new Decide session. A failed run never seeds a follow-up. A call with no `data` and no completed session in the thread does not reach Decide. It returns an `invalid_input` error that asks you to attach a file, because Decide would otherwise charge for a greeting.

Decide returns its session ID only in plain text. `decideSessionIdFromResult` in `packages/agent-runtime/src/decide-analysis-result.ts` reads it from `Session ID: sess_…`, `(session_id: sess_…)`, or an output URL under `/agent-sessions/sess_…/`.

## The start turn ends when the run starts

`ChatSubAgent.beforeTurn` adds a stop condition for the Decide analyze tool. The turn ends in the step that started the run, so the model cannot sleep, retry, or substitute its own analysis while Decide works.

## The status card shows progress, files, and outcome

The analyze call renders as its own card in the timeline (`apps/web/src/features/chat/components/chat-decide-analysis.tsx`), outside the collapsible work group. The card reads `run_id` from the tool output and polls `GET /api/chat/threads/{threadId}/decide-analyses/{runId}` until the run is terminal. The response is `{ run_id, status, progress, result, error }`, plus `files` for a completed run.

The card opens with a fixed line: "I'm running this through Decide. The answer will appear here shortly." While the run works, it shows a spinner with "Analyzing your data…", Decide's latest progress message, the elapsed time, and a Cancel action. After two minutes without a progress message it says "Still working in the background. You can leave this chat; the answer will appear here when it's ready." It settles on "Analysis complete", "Analysis failed" with the stored reason, or "Analysis cancelled". You never see a run ID or session ID.

`decideGeneratedFiles` parses the generated files once from the stored result. It takes every URL whose last path segment has a file extension, plus MCP `resource_link` blocks. The card lists each file with a type icon and an Open action that opens a new tab, because Decide hosts outputs on its own origin, where `download` is ignored. Images get an inline preview.

## The answer arrives through a model turn

After the terminal commit, the Workflow calls `ChatSubAgent.deliverDecideAnalysisResult`. That method calls `Think.submitMessages` with one internal user message whose `metadata.garden.kind` is `decide_analysis_result`. The message ID derives from the run ID and attempt and doubles as the idempotency key, so a Workflow retry runs no second delivery turn. The turn queue runs the submission after any active turn. The chat UI hides internal messages of that kind. The Workflow sets `delivered_at` once the chat accepts the submission.

In the delivery turn the model has no active tools and extra system instructions. It presents Decide's findings with Decide's numbers unchanged. It names generated files without pasting their URLs, and leaves out Decide's narration, progress notes, session IDs, and run IDs. A failed run gets a short plain-language explanation, such as an exhausted Decide credit balance, and no automatic retry.

## The Workflow waits up to one hour

The provider call uses one total MCP request timeout, `DECIDE_ANALYSIS_TIME_LIMIT_MS` (one hour), defined in `apps/web/src/lib/server/executor-engine/direct-decide-mcp.ts`. Progress does not reset it. The provider step's own timeout is that limit plus one minute, so the request timeout fires first and stores the failure "Decide did not finish within 1 hour, so Garden stopped waiting."

The provider step never retries, so a timeout cannot charge twice. Garden records `provider_call_started_at` before it calls Decide. If a Workflow replay finds that marker without a stored result, it records an uncertain provider failure instead of running a second paid analysis. Other Workflow steps retry up to three times with exponential backoff.

Other Decide tools keep the MCP SDK default timeout, which progress resets.

## Each operation opens one closable database client

The service and the Workflow open one closable client per operation. `getPooledDb` builds an unclosed `pg` Pool on every call, and a long analysis once opened a new pool for every progress event.

## The thread is addressed by its runtime key

The service resolves the trusted thread key against `chat_thread.id` or `chat_thread.runtime_key` inside your workspace and owner scope, and stores `chat_thread.id` on the run. Delivery looks up `runtime_key` to address the `ChatSubAgent` facet.
