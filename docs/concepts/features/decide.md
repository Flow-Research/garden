---
title: Decide analysis runs as a durable background job
description: How a chat or automation request to Decide becomes a Workflow-owned run, how the status card tracks it, and how the answer returns to its owner.
status: current
owner: "@Umoren"
last_reviewed: 2026-11-05
---

Decide is an external analysis service that Garden reaches through Executor. When a chat agent or an automation agent asks Decide to analyze data, the analysis can take many minutes. Garden runs it as a background job that outlives the request, shows its progress in a status card, and delivers the answer to whoever started it. In chat, you can leave the thread while it runs. An automation run pauses and resumes when Decide finishes.

The reasons for this design, and the alternatives it beat, are in the decision record [Durable Decide analysis](../../decisions/2026-10-durable-decide-analysis.md). The remaining automation work, a Google Drive source and a report template, is in the proposal [Decide in automations](../../proposals/decide-automations.md).

## Three boundaries own the lifetime of a run

The design holds three boundaries. Passing a browser signal or an OAuth value into the Workflow would break them.

1. The MCP request starts the job and returns at once.
2. `DecideAnalysisWorkflow` (`apps/web/src/decide-analysis-workflow.ts`, binding `DECIDE_ANALYSIS_WORKFLOW`) owns the long-running provider call.
3. Executor owns OAuth and the connection to Decide. The Workflow payload holds only identifiers. Executor resolves the saved token inside its own storage.

## The `decide_analysis_run` table is the source of truth

`packages/db/src/schema/decide-analysis.ts` defines `decide_analysis_run`. A row stores the workspace, the owner, the agent runtime, the question and input data, the attempt and deterministic `workflow_instance_id`, the latest progress, the provider session ID, the result or error, and the timestamps for cancel request, provider call start, start, completion, and delivery.

A run moves through these states:

```text
queued -> running -> completed
                  -> failed
                  -> cancel_requested -> cancelled
```

Terminal updates are conditional. A late provider result cannot overwrite `cancelled`, `failed`, or `completed`.

## Every run has a typed owner

A run belongs to a chat thread or to an automation run:

```ts
type DecideAnalysisOwner =
  | { kind: 'chat'; threadId: string }
  | { kind: 'automation_run'; automationRunId: string }
```

The table stores the owner as `owner_kind`, a nullable `thread_id`, and a nullable `automation_run_id` foreign key. The check constraint `decide_analysis_run_owner_check` requires exactly the ID that matches the kind. Migration `0063` added these columns, and older rows became chat owners through the `owner_kind` default.

The owner decides dedupe, session reuse, and access. The snapshot and the Workflow payload carry the owner, not a thread ID.

The owner is trusted metadata, not a model argument. The MCP wrapper attaches `_meta.garden` to every `decide_analyze` call. A chat facet sends `{ kind: "chat", threadId }` with the model tool-call ID. The automation facet sends `{ kind: "automation_run", automationRunId }`, where the ID is the facet name. `gardenDecideMetaSchema` in `packages/agent-runtime/src/decide-analysis-types.ts` is the one schema for the wrapper and the starter. A direct caller without that metadata, such as a diagnostic, still gets a synchronous call.

## One active run per owner

The model calls `decide_analyze` and gets back `{ run_id, status: "queued" }`. The tool call does not pass the request's abort signal to Decide.

`startDecideAnalysis` in `apps/web/src/lib/server/decide-analysis/service.ts` returns `{ kind: "started" | "already_running", snapshot }`. Two partial unique indexes allow one `queued`, `running`, or `cancel_requested` run per owner: `decide_analysis_run_chat_active_idx` on `thread_id` and `decide_analysis_run_automation_run_active_idx` on `automation_run_id`. A second call while a run is active returns that run and never charges Decide again. Model tool-call IDs, such as `functions.tool_executor_decide_analyze:1`, restart in each thread, so the run stores the ID for tracing only.

## Garden reads the input

A call passes its input in one of two exclusive ways:

```text
decide_analyze({ question, data })
decide_analyze({ question, source: { kind: "brain_file", fileId } })
```

`source` exists so a large sheet does not travel through the model. Before it, the model read a Brain file with `brain_read_file` and pasted the text into `data`, which cost tokens twice and could cut or summarize the sheet. `decideAnalysisSourceSchema` in `packages/agent-runtime/src/decide-analysis-types.ts` defines the source. The handler parses arguments with one Zod object and refuses a call that sends both `data` and `source`, or a `source` without trusted owner metadata.

The service reads the source before it opens the run transaction. `readBrainFileSource` (`apps/web/src/lib/server/decide-analysis/brain-source.ts`) calls `Brain.readFileItem`, the same read behind `brain_read_file`, with the run's user as viewer. It returns the full extracted body; Brain stores an XLSX as tab-separated sheet text. A missing, hidden, empty, or unextracted file returns `source_unavailable` and creates no run.

Decide accepts inputs up to 100 MB (confirmed with Decide on 2026-11-03). The service measures `data` or the read source in UTF-8 bytes against `DECIDE_ANALYSIS_INPUT_LIMIT_BYTES` (100,000,000). An input over the limit returns `input_too_large`, so no run row exists and no paid analysis starts.

## Garden owns the Decide session

The model does not pass a `session_id`. A call with neither `data` nor `source` reuses the provider session of the owner's latest `completed` run. A call with new input starts a new Decide session. A failed run never seeds a follow-up. A call with no input and no completed session for the owner does not reach Decide. It returns an `invalid_input` error that asks you to attach a file, because Decide would otherwise charge for a greeting.

Decide returns its session ID only in plain text. `decideSessionIdFromResult` in `packages/agent-runtime/src/decide-analysis-result.ts` reads it from `Session ID: sess_…`, `(session_id: sess_…)`, or an output URL under `/agent-sessions/sess_…/`.

## The start turn ends when the run starts

In chat, `ChatSubAgent.beforeTurn` adds a stop condition for the Decide analyze tool. The turn ends in the step that started the run, so the model cannot sleep, retry, or substitute its own analysis while Decide works. In an automation, `stopAfterAutomationDecideAnalysisStarts` does the same. A refused start does not end the turn, so the agent can still report the error.

## The status route is owner-agnostic

Both surfaces read one route:

```text
GET  /api/decide-analyses/{runId}
  -> { runId, status, progress, error, files, createdAt, startedAt, completedAt }
POST /api/decide-analyses/{runId}  { action: "cancel" | "retry", retry_key? }
```

The route reads the run, then requires workspace membership. A chat run is visible only to the user who owns its thread, and never from another thread. An automation run's analysis is visible to every workspace member, and cancel or retry needs `automationManage`. A run the caller may not see returns 404.

## The status card shows progress, files, and outcome

`DecideAnalysisStatusCard` (`apps/web/src/features/chat/components/chat-decide-analysis.tsx`) polls the status route until the run is terminal. In chat it renders as its own card in the timeline, outside the collapsible work group. The automation run page shows one card for each analysis the run started; the runs list returns `decide_analysis_run_ids` for that.

In chat the card opens with a fixed line: "I'm running this through Decide. The answer will appear here shortly." While the run works, it shows a spinner with "Analyzing your data…", Decide's latest progress message, the elapsed time, and a Cancel action. After two minutes without a progress message it says "Still working in the background. You can leave this chat; the answer will appear here when it's ready." It settles on "Analysis complete", "Analysis failed" with the stored reason, or "Analysis cancelled". You never see a run ID or session ID.

`decideGeneratedFiles` parses the generated files once from the stored result. It takes every URL whose last path segment has a file extension, plus MCP `resource_link` blocks. The card lists each file with a type icon and an Open action that opens a new tab, because Decide hosts outputs on its own origin, where `download` is ignored. Images get an inline preview.

## In chat, the answer arrives through a model turn

After the terminal commit, the Workflow calls `ChatSubAgent.deliverDecideAnalysisResult`. That method calls `Think.submitMessages` with one internal user message whose `metadata.garden.kind` is `decide_analysis_result`. The message ID derives from the run ID and attempt and doubles as the idempotency key, so a Workflow retry runs no second delivery turn. The turn queue runs the submission after any active turn. The chat UI hides internal messages of that kind. The Workflow sets `delivered_at` once the chat accepts the submission.

In the delivery turn the model has no active tools and extra system instructions. It presents Decide's findings with Decide's numbers unchanged. It names generated files without pasting their URLs, and leaves out Decide's narration, progress notes, session IDs, and run IDs. A failed run gets a short plain-language explanation, such as an exhausted Decide credit balance, and no automatic retry.

The service resolves the trusted thread key against `chat_thread.id` or `chat_thread.runtime_key` inside your workspace and owner scope, and stores `chat_thread.id` on the run. Delivery looks up `runtime_key` to address the `ChatSubAgent` facet.

## In an automation, the run pauses and resumes

An automation run pauses on Decide instead of blocking on it, and stays `running` while it waits.

1. **The run waits in `RunWorkflow`.** `completeAutomationRunTurn` returns `waitingOn: { kind: "decide_analysis", decideRunId, settled }` for the latest analysis whose `delivered_at` is null. `RunWorkflow` calls `step.waitForEvent("turn-N-decide-analysis", { type: "decide-analysis-finished:<decideRunId>", timeout })`. When `settled` is true, Decide already finished and the Workflow skips the wait. See [Run engine](../architecture/run-engine.md).
2. **Decide wakes the run.** The Decide Workflow's publish step sends that event to the `RunWorkflow` instance keyed by the automation run ID. It does so for every terminal outcome, cancelled included, and also when a cancel landed before the claim or the Workflow failed.
3. **The agent resumes.** The next turn runs with `mode: "resume"` and the Decide run ID. The facet reads that run from the database, not from the event, and hands the agent one internal message built by `decideAnalysisAutomationResumeText` (`packages/agent-runtime/src/decide-analysis-automation.ts`): the findings and file links, the failure reason, or a cancelled note. It records `delivered_at` in the same transaction. The agent then writes the output and calls `complete_automation`.

`DECIDE_ANALYSIS_OWNER_WAIT_MS` bounds the wait: the one-hour time limit plus ten minutes, which covers the provider step, the commit retries, and the notify step's retries. A wait that times out still resumes the agent. The facet then finds the Decide run still active, requests its cancel, and tells the agent that Garden stopped waiting.

The agent's `runTimeoutSec` guard does not count the pause. `runExceededTimeout` in `packages/agent-runtime/src/run-timeout.ts` subtracts the time each of the run's analyses ran from the run's elapsed time.

Cancelling the automation run calls `AutomationRunSubAgent.requestCancel`. That requests cancel on the active analysis and sends its finished event, so a paused run wakes, sees the cancel request, and closes as `cancelled` without waiting for Decide.

## The Workflow waits up to one hour

The provider call uses one total MCP request timeout, `DECIDE_ANALYSIS_TIME_LIMIT_MS` (one hour), defined in `apps/web/src/lib/server/executor-engine/direct-decide-mcp.ts`. Progress does not reset it. The provider step's own timeout is that limit plus one minute, so the request timeout fires first and stores the failure "Decide did not finish within 1 hour, so Garden stopped waiting."

The provider step never retries, so a timeout cannot charge twice. Garden records `provider_call_started_at` before it calls Decide. If a Workflow replay finds that marker without a stored result, it records an uncertain provider failure instead of running a second paid analysis. Other Workflow steps retry up to three times with exponential backoff.

Other Decide tools keep the MCP SDK default timeout, which progress resets.

## Each operation opens one closable database client

The service and the Workflow open one closable client per operation. `getPooledDb` builds an unclosed `pg` Pool on every call, and a long analysis once opened a new pool for every progress event.
