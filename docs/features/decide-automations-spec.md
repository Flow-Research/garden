# Decide in Automations

**Status:** spec, not built
**Last reviewed:** 2026-11-03

## The problem

A Garden user wants a sales report every Monday. They keep the sheet in Google
Drive, or they uploaded it to Brain. Today an automation can see the
`decide_analyze` tool, but calling it from an automation fails in three ways.

First, the call blocks. Automation runs are not chats, so the background-run
path in `decide-analysis-starter.ts` does not apply, and the call runs directly
under the MCP SDK's 60-second silence timeout. An analysis that goes quiet for
a minute fails, and Decide may still finish and charge for it.

Second, nothing records the call. There is no `decide_analysis_run` row, so the
run page cannot show progress, offer Cancel, explain a failure, or link the
generated files.

Third, the data travels through the model. The agent reads the whole file with
`brain_read_file` or a Drive tool, then copies the text into the `data`
argument. A large sheet costs model tokens twice and can be truncated or
summarised on the way, which the Decide integration guide warns against.

## What the user gets

1. They pick the **Weekly data report** template, choose a file from Brain or
   Google Drive, write the question ("Which region grew fastest, and why?"),
   choose who receives the report, and set a schedule.
2. On each run, the run page shows the same Decide card as chat: status,
   elapsed time, Decide's progress, Cancel, the failure reason, and file links.
3. When Decide finishes, the agent writes the report from the findings and
   sends it through the chosen channel (Gmail or Slack), with links to the
   generated files.

## Design

### One Decide run, two kinds of owner

`decide_analysis_run` gains a typed owner. Today it always belongs to a chat
thread.

```ts
type DecideAnalysisOwner =
  | { kind: 'chat'; threadId: string }
  | { kind: 'automation_run'; automationRunId: string }
```

In the schema this is an `owner_kind` column (`chat | automation_run`), a
nullable `automation_run_id` foreign key, and `thread_id` made nullable. A
check constraint requires exactly the ID that matches the kind. The
one-active-run index becomes one active run per owner. Edit the Drizzle schema
and run `db:generate`.

The Decide Workflow does not change: one hour limit, no provider retries, no
double charge. Only delivery branches on the owner.

### Garden reads the file, not the model

`decide_analyze` gains a typed `source` argument in place of pasted `data`, for
owners that have one.

```ts
type DecideAnalysisSource =
  | { kind: 'brain_file'; fileId: string }
  | { kind: 'drive_file'; fileId: string }
```

The service resolves the source when it creates the run and stores the text in
`input_data`.

- **Brain** reuses the `brain_read_file` service. It returns the complete
  extracted text, and an XLSX comes back as tab-separated sheet text.
- **Google Drive** uses the user's Drive connection to download the file. A
  Google Sheet is exported as CSV. An uploaded XLSX needs the same
  sheet-to-text step Brain uses (see open questions).

Chat keeps pasted `data` and can use `source` too.

### The automation waits on a Workflow event

When an automation calls `decide_analyze`, the starter creates the run for the
`automation_run` owner and returns at once, as it does in chat. The automation
agent's turn then ends with the run waiting on Decide.

`RunWorkflow` waits for a `decide-analysis-finished:<decideRunId>` event with
`waitForEvent`. The run base already pauses this way for approvals
(`run-sub-agent-base.ts`, the event-driven bridge), so this adds no waiting
layer. The Decide Workflow's publish step sends the event when the run is
terminal. Then `RunWorkflow` resumes the agent with one internal message
holding the findings, the generated files, or the failure reason. The agent
writes and sends the report and calls `complete_automation`.

The `RunWorkflow` wait gets the same bound as the Decide call,
`DECIDE_ANALYSIS_TIME_LIMIT_MS` plus a margin, so neither side waits forever.
The agent's own `runTimeoutSec` must not end the run while it is waiting. The
pause is Workflow time, not turn time.

Cancelling the automation run also requests cancel on its active Decide run.

### The run page shows the card

The automation run detail page renders the same Decide card component as chat.
The card is driven by an owner-agnostic status route, so it needs no chat
thread.

### The template

`WEEKLY_DATA_REPORT_TEMPLATE` is added to `BUILTIN_AUTOMATION_TEMPLATES` in
`packages/core/src/automations/templates.ts`.

- The execution config declares Decide as a required connector, with Gmail or
  Slack depending on the delivery choice. That needs `decide` added to the
  `requiredConnectors` enum.
- The run input contract is typed: `{ source: DecideAnalysisSource; question:
  string; deliverTo: { channel: 'gmail' | 'slack'; target: string } }`.
- The prompt tells the agent to call `decide_analyze` with `source`, never to
  paste file contents, and to send the report only from Decide's findings.

UI, API writes, and the runtime read this one definition. No ad hoc config
blobs.

## Delivery order

1. Owner type, migration, Brain `source`, and the size check.
2. Automation pause and resume through `RunWorkflow`, and the run-page card.
3. Drive `source` and the Weekly data report template.

## Out of scope

- A run-finished notification in Garden's UI. That is a separate follow-up for
  chat and automations.
- Issues and tasks as Decide owners. The owner type makes that a later
  addition.
- Fetching a Decide result after a dropped connection. Decide has no tool for
  it (integration guide: `analyze`, `list_generated_files`,
  `read_generated_file`, `whoami`).

## Input limits and formats

Decide accepts XLSX and inputs up to 100 MB (confirmed with Decide,
2026-11-03). Brain's Files & Folders accepts XLSX uploads, and
`brain_read_file` already returns them as tab-separated sheet text, so Brain
sources work with no new conversion. Drive XLSX files use the same
sheet-to-text step. The service rejects a resolved source larger than 100 MB
before creating the run, so an oversized file never starts a paid analysis.

## Verification

- Unit: owner check constraint, one-active-run-per-owner, source resolution
  for Brain and Drive including XLSX to text, and the 100 MB rejection.
- Workflow: Decide completion sends the event, `RunWorkflow` resumes the agent,
  a Decide failure reaches the agent and the run page, and Cancel stops both.
- Live on dev: create a Weekly data report from a Brain XLSX, run it manually,
  watch the card on the run page, and receive the email with file links.
