# Durable Decide analysis

## Problem

The current `decide_analyze` call runs inside the live chat MCP request. The
MCP handler passes that request's `AbortSignal` to Decide. A browser or chat
disconnect can therefore stop the provider call. Garden also stores neither
progress nor the final result for reconnect.

Decide analysis needs a separate job lifetime. The chat request must start the
job and return a run ID. A Cloudflare Workflow must own the provider call. A
Postgres run record must own the product state.

## Usage

The chat-facing MCP tool starts a job:

```text
decide_analyze({ question, data })
decide_analyze({ question, source: { kind: "brain_file", fileId } })
  -> { run_id, status: "queued" }
```

`data` and `source` are exclusive. See [Garden reads the file](#garden-reads-the-file).

The tool call does not pass the chat request signal to Decide. The browser can
disconnect after it receives the run ID.

The status API reads the durable snapshot. It does not depend on the owner:

```text
GET  /api/decide-analyses/{runId}
  -> { runId, status, progress, error, files, createdAt, startedAt, completedAt }
POST /api/decide-analyses/{runId}  { action: "cancel" | "retry", retry_key? }
```

The route reads the run, then requires workspace membership. A chat run is
visible only to the user who owns its thread. An automation run's analysis is
visible to every workspace member, and cancel or retry needs
`automationManage`, the permission that runs automations. A run the caller
may not see returns 404. The thread-scoped route
`/api/chat/threads/{threadId}/decide-analyses/{runId}` was removed; the chat
card uses this route too.

The Workflow delivers the final result through a model turn. See
[Chat contract](#chat-contract) for how the user sees the run and its answer.

## Chat contract

The first release of this design returned a bare run ID to the model and
appended Decide's raw output with `Think.addMessages`. A live test showed the
cost. The model had no status tool, so it called `sleep`, started a second
paid run, and then redid the analysis in the sandbox. Decide's raw blocks,
including session IDs and progress logs, then landed in the middle of that
turn. The rules below replace that behavior.

### Run owner

A run has a typed owner:

```ts
type DecideAnalysisOwner =
  | { kind: 'chat'; threadId: string }
  | { kind: 'automation_run'; automationRunId: string }
```

The table stores it as `owner_kind`, a nullable `thread_id`, and a nullable
`automation_run_id` foreign key. The check constraint
`decide_analysis_run_owner_check` requires exactly the ID that matches the
kind. Migration `0063` added the columns. Rows from before it became chat
owners through the `owner_kind` default, and they already had a thread ID.

The owner decides dedupe, session reuse, and access. Status, list, cancel,
and retry match the run's owner against the caller's. A chat run is invisible
from another thread, even for the same user. The snapshot and the Workflow
payload carry the owner instead of a thread ID.

The service can create a run for an automation run in the caller's
workspace, attributed to that run's agent. An automation agent's
`decide_analyze` call does so; see [Automation owners](#automation-owners).

### One active run per owner

Two partial unique indexes allow one `queued`, `running`, or
`cancel_requested` run per owner:
`decide_analysis_run_chat_active_idx` on `thread_id` and
`decide_analysis_run_automation_run_active_idx` on `automation_run_id`. The
rest of this section describes chat, and the same rules hold per automation
run. `startDecideAnalysis` returns
`{ kind: "started" | "already_running", snapshot }`. A second call while a run
is active returns the existing run and never charges Decide again. An MCP
retry of the same call lands on that active run too.

The active run is the only run a start ever returns. A finished run, or a run
in another thread, is never returned, even when its stored tool-call ID
matches. Model tool-call IDs are not unique: they look like
`functions.tool_executor_decide_analyze:1` and the counter restarts in each
thread. An earlier workspace-wide lookup by that ID handed a new chat another
chat's failed run, so no analysis ran. The ID is now stored for tracing only
and has no unique index.

### Garden owns the Decide session

The model no longer passes `session_id` in chat. When a call omits both
`data` and `source`, the service reuses the provider session of the owner's
latest `completed` run. A call with new `data` or a `source` starts a new
Decide session. A failed run never seeds a follow-up. A call with no input
and no completed session for the owner does not reach Decide: the tool returns an `invalid_input`
error that asks the user to attach the file, because Decide would otherwise
charge for a greeting. Direct non-chat callers keep the explicit `session_id`
argument.

Decide returns plain `content` text blocks and no `structuredContent`. The
Workflow reads the session ID from that text with
`decideSessionIdFromResult` (`packages/agent-runtime/src/decide-analysis-result.ts`).
Decide prints it as `Session ID: sess_…`, as `(session_id: sess_…)`, and
inside output URLs under `/agent-sessions/sess_…/`.

### Garden reads the file

Before, the model read a Brain file with `brain_read_file` and pasted the
text into `data`. A large sheet cost model tokens twice and could be cut or
summarised on the way. Now `decide_analyze` takes a typed `source`:

```ts
type DecideAnalysisSource = { kind: 'brain_file'; fileId: string }
```

The schema is `decideAnalysisSourceSchema` in
`packages/agent-runtime/src/decide-analysis-types.ts`. Google Drive will be a
second variant. The handler parses the arguments with one Zod object and
refuses a call that sends both `data` and `source`. A direct call without
chat metadata cannot read a source, so it is refused too.

The service reads the source before it opens the run transaction.
`readBrainFileSource` (`apps/web/src/lib/server/decide-analysis/brain-source.ts`)
calls `Brain.readFileItem`, the read behind `brain_read_file`, with the run's
user as viewer. It returns the full extracted body, and Brain stores an XLSX
as tab-separated sheet text. The text goes into `input_data`. A missing,
hidden, empty, or unextracted file returns `source_unavailable` and creates no
run. An empty file never falls through to a follow-up on an earlier session.
The Decide routing directive tells the model to pass `source` for a Files &
Folders file and not to call `brain_read_file`.

### Input limit

Decide accepts inputs up to 100 MB (confirmed with Decide, 2026-11-03).
Before the run is created, the service measures the input in UTF-8 bytes
against `DECIDE_ANALYSIS_INPUT_LIMIT_BYTES` (100,000,000). Pasted `data` and
a read source get the same check. An input over the limit returns
`input_too_large`, so no run row exists and no paid analysis starts.

### The turn ends when the run starts

`ChatSubAgent.beforeTurn` adds a stop condition for the Decide analyze tool,
next to the existing stop condition for a selected Decide failure. The turn
ends in the step that started the run. The model cannot sleep, retry, or
substitute a local analysis while Decide works. The tool text tells the model
that the answer will appear in the chat. The structured content keeps
`run_id` for the UI only.

### The chat shows a Decide status card

The Decide analyze call renders as its own card in the timeline, outside the
collapsible work group. Inside the group it sat under a header that read
"Completed" while Decide was still working. The card reads `run_id` from the
tool output and polls the status API while the run is not terminal.

The card opens with a fixed line: "I'm running this through Decide. The
answer will appear here shortly." The start turn ends in code right after the
tool call, so the model writes nothing, and fixed copy is deterministic,
costs no tokens, and survives a reload. Below it, a live status shows a
spinner and "Analyzing your data…", Decide's latest progress message, the
elapsed time, and a Cancel action. It settles on "Analysis complete",
"Analysis failed", or "Analysis cancelled". The user never sees a run ID or
session ID. A cancelled run needs no chat message because the card shows the
outcome. A failed card shows the reason the run stored, as written. Past two minutes,
a running card without a Decide progress message says "Still working in the
background. You can leave this chat; the answer will appear here when it's
ready."

### Generated files render as file cards

The status API returns `files: { name, url }[]` for a completed run. The
service parses them once from the stored result with `decideGeneratedFiles`:
any URL in Decide's text whose last path segment has a file extension, plus
MCP `resource_link` blocks. The card lists each file with its name, a type
icon, and an Open action that opens the file in a new tab, since Decide hosts
outputs on its own origin where `download` is ignored. Images get an inline
preview. Links never depend on model markdown.

### The answer arrives through a model turn

After the terminal commit, the Workflow calls
`ChatSubAgent.deliverDecideAnalysisResult`. That method calls
`Think.submitMessages` with one internal user message. The message carries
`metadata.garden.kind = "decide_analysis_result"` and a stable ID derived from
the run ID and attempt, which is also the submission's idempotency key. A
Workflow retry finds the existing submission and runs no second delivery
turn. The submission is durable in the facet and returns at once, so the
Workflow step does not hold an RPC open for the whole model turn.
`saveMessages` was rejected for that reason, and because its
`shouldApplyMessages` option is not in the published `SaveMessagesOptions`
type. The turn queue runs the submission after any active turn, so it never
splices into a running turn. The chat UI hides internal messages of that
kind.

In the delivery turn, Garden gives the model no active tools and adds
instructions to the system prompt. A live test showed why: with only the
Decide tools removed, the model answered a failed run with its own local
analysis. The model presents Decide's findings with Decide's numbers
unchanged, refers to generated files by name without pasting their URLs
because the card already shows them, and leaves out Decide's own narration, progress notes, session IDs, and run IDs.
A failed run produces a short explanation of the error in plain language, such
as an exhausted Decide credit balance, with no automatic retry. The Workflow
records `delivered_at` once the chat accepts the submission.

### Thread identity

The chat facet is named by `chat_thread.runtime_key`, which equals the issue
ID for issue-linked threads. The service resolves the trusted thread key
against `id` or `runtime_key` inside the caller's workspace and owner scope.
It stores `chat_thread.id` on the run. Delivery looks up `runtime_key` to
address the facet.

### Timeouts

Decide no longer limits analysis time, its progress events are optional, and
it has no tool to fetch a finished result later (the integration guide lists
`analyze`, `list_generated_files`, `read_generated_file`, and `whoami`). So
Garden holds the `analyze` request open instead of judging it by silence.

The background call passes one total MCP request timeout,
`DECIDE_ANALYSIS_TIME_LIMIT_MS` (one hour), and progress no longer resets it.
Before, the call used the MCP SDK's 60-second silence timeout, and a dev run
failed with `MCP error -32001: Request timed out` while Decide was likely
still working and charging. Workflows give a step unlimited wall-clock time
while it waits on I/O, so the hour is a product choice: long reports finish,
and a request that will never answer still ends. The provider step's timeout
is that limit plus one minute, so the request's own timeout fires first and
commits the plain failure "Decide did not finish within 1 hour, so Garden
stopped waiting." The provider step never retries, so a timeout cannot charge
twice.

Other Decide tools keep the SDK default timeout reset by progress.

### Database connections

The service and Workflow open one closable client per operation instead of
calling `getPooledDb`, which builds an unclosed `pg` Pool on every call. A
long analysis previously opened a new pool for every progress event.

### Automation owners

An automation run pauses on Decide instead of blocking on it.

1. **Trusted owner.** The MCP wrapper attaches `_meta.garden` to every
   `decide_analyze` call. A chat facet sends `{ kind: "chat", threadId }`. The
   automation facet sends `{ kind: "automation_run", automationRunId }`, where
   the ID is the facet name, which is the run ID. Model arguments never set
   it. `gardenDecideMetaSchema` in
   `packages/agent-runtime/src/decide-analysis-types.ts` is the one schema
   for both the wrapper and the starter.
2. **The turn ends.** The starter creates the run for the automation owner
   and returns text that says the run will resume.
   `stopAfterAutomationDecideAnalysisStarts` ends the turn in the step where
   Decide accepted the run. A refused start does not end the turn, so the
   agent can still report the error.
3. **The run waits in `RunWorkflow`.** The run stays `running`.
   `completeAutomationRunTurn` returns
   `waitingOn: { kind: "decide_analysis", decideRunId, settled }` for the
   latest analysis whose `delivered_at` is null. `RunWorkflow` then calls
   `step.waitForEvent("turn-N-decide-analysis", { type:
"decide-analysis-finished:<decideRunId>", timeout })`. This is the same
   event bridge the turn-complete wait uses, with no second wait or recovery
   layer. When `settled` is true, Decide already finished and there is no
   wait.
4. **Decide wakes the run.** For an automation owner, the Decide Workflow's
   publish step sends that event to the `RunWorkflow` instance whose ID is
   the automation run ID. It does so for every terminal outcome, cancelled
   included, and also when a cancel landed before the claim or the Workflow
   failed. A chat owner is unchanged.
5. **The agent resumes.** The next turn runs with `mode: "resume"` and the
   Decide run ID. The facet reads that run from the database, not from the
   event, and hands the agent one internal message built by
   `decideAnalysisAutomationResumeText`
   (`packages/agent-runtime/src/decide-analysis-automation.ts`): the findings
   and the file names with their URLs, the failure reason, or a cancelled
   note. It records `delivered_at` in the same transaction. The agent writes
   the output and calls `complete_automation`.

The wait is bounded by `DECIDE_ANALYSIS_OWNER_WAIT_MS`, the one-hour
`DECIDE_ANALYSIS_TIME_LIMIT_MS` plus ten minutes. The provider step can run
for the limit plus one minute, the commit step retries for at most 35 seconds,
and the notify step's default retries take at most about five minutes. A wait
that times out still resumes the agent. The facet then finds the Decide run
still active, requests its cancel, and tells the agent that Garden stopped
waiting.

The agent's `runTimeoutSec` guard does not count the pause. It subtracts the
time each of the run's analyses ran (`created_at` to `completed_at`, or to
now) from the run's elapsed time (`runExceededTimeout` in
`packages/agent-runtime/src/run-timeout.ts`).

Cancelling the automation run calls `AutomationRunSubAgent.requestCancel`.
That requests cancel on the run's active analysis and sends the analysis's
finished event, so a paused run wakes, sees the cancel request, and closes as
`cancelled` without waiting for Decide.

The automation run page shows a Decide card for each analysis the run
started. The runs list returns `decide_analysis_run_ids`, and the card
(`DecideAnalysisStatusCard`) reads the owner-agnostic status route. Chat
renders the same card under its fixed opening line.

## Shape

Garden adds a dedicated `DecideAnalysisWorkflow` binding. It does not add a
`decide_analysis` branch to `RunWorkflow`. `RunWorkflow` owns issue and
automation turn loops. Decide needs a provider call, a different retry policy,
and a different result shape.

The `decide_analysis_run` table stores:

- the stable public run ID;
- the owner (chat thread or automation run) and AgentDO runtime;
- the validated question and input data;
- the current attempt and deterministic Workflow instance ID;
- the latest customer-safe progress;
- the provider `session_id`;
- the complete MCP result or safe error;
- cancellation and terminal timestamps.

The Workflow payload contains identifiers only. It does not contain OAuth
tokens, authorization headers, or raw CSV data. The Workflow loads the job
record, creates a workspace and user-scoped Executor, and calls the extracted
worker-only Decide operation. Executor resolves the saved OAuth token inside
its own storage.

The MCP adapter remains available for direct non-chat callers. Chat calls add
trusted `_meta` with the thread ID and model tool-call ID. The adapter uses
that metadata to create an asynchronous run. Without the trusted metadata,
the adapter keeps the existing synchronous direct call for diagnostics and
other internal callers.

The run state uses these transitions:

```text
queued -> running -> completed
                  -> failed
                  -> cancel_requested -> cancelled
```

Terminal updates use a conditional database update. A late provider result
cannot replace `cancelled`, `failed`, or `completed`.

Garden records when a provider call starts. If a Workflow replay sees that
marker before it has a stored result, it records an uncertain provider failure
instead of silently running a second paid analysis. Decide does not yet expose
a Garden idempotency key.

Live progress is an optimization. The database snapshot is the source of
truth after reconnect. The delivery turn is idempotent by message ID.

## Synthesis decision

The arena compared two candidates:

1. Extend `RunWorkflow` with a new Decide payload kind.
2. Add a separate `DecideAnalysisWorkflow` binding.

The separate Workflow won. The cross-judge scored it 20/25 against 14/25 for
the shared Workflow. It keeps provider retry rules, result storage, and chat
analysis semantics outside the issue and automation control flow. It also lets
the provider worker stay in `apps/web`, where the Executor runtime already
owns OAuth resolution.

The implementation grafts the first candidate's deterministic instance IDs
and conditional terminal transitions into the separate Workflow.

## Tradeoffs accepted

- We accept one more Workflow binding in exchange for a clear failure boundary.
- We accept storing the current MCP result in the run record in exchange for a
  small first implementation. A later result-object store can move large
  payloads without changing the job API.
- We accept at-least-once provider execution when a Worker crashes after the
  provider accepts a request and before Garden stores the result. Garden marks
  that state as uncertain instead of retrying silently.
- We accept polling as the reconnect source of truth. Live push can be added
  later without changing the run state model.

## Alternatives considered

### Extend `RunWorkflow`

This uses fewer bindings, but it exposes issue and automation branching to a
third product surface. It makes the shared Workflow understand another ledger,
another result shape, and another retry policy. The public surface is smaller
at the binding level and larger in the Workflow contract, so it lost.

### Reuse `issue_run` or `automation_run`

These tables require product relationships that chat analysis does not have.
Their event and permission semantics would leak into the analysis job.

### Keep the MCP request open

This keeps the current call shape, but the browser and MCP request still own
the provider lifetime. A longer timeout does not fix a disconnect.

## Implementation reconciliation

The implementation must preserve three boundaries:

1. the chat MCP request starts the job;
2. the Workflow owns durable execution;
3. Executor owns OAuth and the provider connection.

Any change that passes a browser signal or OAuth value into the Workflow is a
design violation.

## Next implementation step

Add the run schema and service contract, then wire the separate Workflow and
the trusted MCP start metadata.
