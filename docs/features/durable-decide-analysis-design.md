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
  -> { run_id, status: "queued" }
```

The tool call does not pass the chat request signal to Decide. The browser can
disconnect after it receives the run ID.

The status API reads the durable snapshot:

```text
GET /api/chat/threads/{threadId}/decide-analyses/{runId}
  -> { run_id, status, progress, result, error }
```

The Workflow delivers the final result through a model turn. See
[Chat contract](#chat-contract) for how the user sees the run and its answer.

## Chat contract

The first release of this design returned a bare run ID to the model and
appended Decide's raw output with `Think.addMessages`. A live test showed the
cost. The model had no status tool, so it called `sleep`, started a second
paid run, and then redid the analysis in the sandbox. Decide's raw blocks,
including session IDs and progress logs, then landed in the middle of that
turn. The rules below replace that behavior.

### One active run per thread

A partial unique index allows one `queued`, `running`, or `cancel_requested`
run per chat thread. `startDecideAnalysis` returns
`{ kind: "started" | "already_running", snapshot }`. A second call while a run
is active returns the existing run and never charges Decide again. The
tool-call idempotency key still deduplicates MCP retries of the same call.

### Garden owns the Decide session

The model no longer passes `session_id` in chat. When a chat call omits
`data`, the service reuses the provider session of the thread's latest
`completed` run. A call with new `data` starts a new Decide session. A failed
run never seeds a follow-up. A call with no `data` and no completed session
in the thread does not reach Decide: the tool returns an `invalid_input`
error that asks the user to attach the file, because Decide would otherwise
charge for a greeting. Direct non-chat callers keep the explicit `session_id`
argument.

Decide returns plain `content` text blocks and no `structuredContent`. The
Workflow reads the session ID from that text with
`decideSessionIdFromResult` (`packages/agent-runtime/src/decide-analysis-result.ts`).
Decide prints it as `Session ID: sess_…`, as `(session_id: sess_…)`, and
inside output URLs under `/agent-sessions/sess_…/`.

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
outcome.

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

Decide no longer enforces its own analysis timeout, and Garden drops its
five-minute `maxTotalTimeout`. The MCP call keeps `resetTimeoutOnProgress`,
so the request timeout only measures silence between progress events.
Decide publishes no progress cadence, so Garden keeps the MCP SDK default
request timeout of 60 seconds. The Workflow step timeout, 10 minutes per
attempt by default, remains the outer bound.

### Database connections

The service and Workflow open one closable client per operation instead of
calling `getPooledDb`, which builds an unclosed `pg` Pool on every call. A
long analysis previously opened a new pool for every progress event.

## Shape

Garden adds a dedicated `DecideAnalysisWorkflow` binding. It does not add a
`decide_analysis` branch to `RunWorkflow`. `RunWorkflow` owns issue and
automation turn loops. Decide needs a provider call, a different retry policy,
and a different result shape.

The `decide_analysis_run` table stores:

- the stable public run ID;
- the chat thread and AgentDO runtime;
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
