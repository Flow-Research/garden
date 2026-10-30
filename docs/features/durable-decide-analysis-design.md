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

The Workflow appends the final result to the chat with `Think.addMessages`.
The message ID is derived from the run ID, so a retry cannot add the result
twice.

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
truth after reconnect. The final chat message is idempotent and contains the
ordered text result and generated-file links returned by Decide.

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
