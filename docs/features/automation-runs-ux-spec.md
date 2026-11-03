# Automation Runs UX

**Status:** spec, not built. Implementation brief for the branch
`feat/automation-runs-ux`.
**Last reviewed:** 2026-11-03

## The problem

On 2026-11-03 a manual run of the automation "Decide test – sales report"
worked end to end on `garden-dev`. The agent called Decide, paused, resumed,
and wrote a full report with a chart. The user still could not find the
result.

- **Run history is buried.** `RUN HISTORY` is a section at the bottom of
  `/workflows/$id`, below Properties, the prompt, and Triggers. Nothing above
  the fold says a run exists.
- **A run cannot be opened.** Each run is one row (`RunRow` in
  `apps/web/src/features/automations/automation-detail-page.tsx`, line ~245)
  with the output inlined. There is no run page, URL, or place to read the
  steps the agent took.
- **Reports show raw markdown.** `result_json.output` renders as plain text,
  so the user sees `## Sales Report`, `**North**`, and
  `[file.png](https://…)` as literal characters.
- **The surface has two names.** The sidebar and URL say **Workflows**, and
  the page heading says **Automations** (`automations-page.tsx`, line ~1095).

## Outcome

A user who clicks **Run now** sees the run at the top of the page within a
second. Clicking it opens a run page with the formatted report, the Decide
card and file cards, and the steps the agent took. Every label says
**Workflows**.

## Changes

### 1. Runs first on the workflow page

`apps/web/src/routes/_authenticated/_app/workflows.$id.tsx` and
`automation-detail-page.tsx`:

- Add two tabs under the header: **Runs** (the default) and **Settings**.
- **Runs** lists runs newest first. Each row shows the status badge, the
  trigger source (Manual, Schedule, Webhook, or API), a relative start time,
  the duration, and a one-line summary. The summary is the first plain-text
  line of `result_json.output` with markdown stripped, or the failure reason
  for a failed run.
- The whole row links to the run page.
- Show an empty state, "No runs yet. Click Run now to start one.", when there
  are no runs.
- **Settings** holds what the page shows today: Properties, the prompt,
  Triggers, and the Danger zone. Move it; do not redesign it.
- The tab lives in the URL search params (`?tab=runs|settings`, validated
  with zod in the route's `validateSearch`) so reloads and links keep it.
- After **Run now**, switch to Runs and put the new run at the top. Use an
  optimistic row or `invalidateQueries` on the runs query key in the mutation's
  `onSuccess`. Do not poll with `useEffect`. `useEffect` is banned in this repo.
- While a run is `queued` or `running`, the runs query refetches on an interval
  through TanStack Query's `refetchInterval` callback. Return `false` once no
  run is active.

### 2. Run detail page

New route `apps/web/src/routes/_authenticated/_app/workflows.$id.runs.$runId.tsx`.
Read the TanStack Router skill docs first; see the repo `CLAUDE.md` for the
paths.

- Load data with a route loader that prefetches through the existing query
  options, so the page renders without a spinner. Fetch from the existing
  `GET /api/runs/$id` (`apps/web/src/routes/api/runs/$id.ts`). Extend its
  response only if a field below is missing, and keep the response shape in a
  shared zod schema.
- Show the run's status, source, started and finished times, duration, and
  model and token usage (already in `usage_json`). Put a breadcrumb back to the
  workflow.
- **Report:** render `result_json.output` with the chat markdown renderer
  `MessageResponse` (`apps/web/src/components/ai-elements/message.tsx`, line
  ~455). Links open in a new tab.
- **Decide:** render one `DecideAnalysisStatusCard` per ID in
  `decide_analysis_run_ids`. `RunRow` already does this; move that code here.
  The card shows status, Cancel while running, the failure reason, and file
  cards with image previews.
- **Steps:** render the trace that `traceEvents(result)` already builds in
  `automation-detail-page.tsx`, as a collapsible list: tool name, short input,
  status. Hide raw JSON unless debug mode is on, the same `debugMode` flag
  `RunRow` uses today.
- A failed run shows its error message in plain words above the report.

### 3. Move the shared Decide card

`DecideAnalysisStatusCard` lives in `apps/web/src/features/chat/components/`,
and the automations feature imports it from there. Move it to
`apps/web/src/features/decide/decide-analysis-status-card.tsx`, along with the
helpers it needs from `chat-message-model.ts`: the card view, step view, file
kind, `formatElapsed`, and `DECIDE_LONG_RUN_MS`. Update the chat and
automation imports. Chat must look and behave exactly the same.

### 4. One name

User-facing copy says **Workflows** everywhere: the page heading, the empty
state, buttons ("New workflow"), dialog titles, and toasts. Do not rename code
identifiers, database tables, or API routes. This is copy only.

## Rules (from the repo `CLAUDE.md`)

- Do not use `useEffect`. Use loaders, query options, event handlers, or
  derived state.
- Do not use `try/catch`. Use `better-result` on the server.
- Validate at boundaries with zod.
- Add JSDoc to non-trivial components and hooks: why it exists, behavior
  before, and behavior after.
- Format with oxfmt and lint with oxlint. Do not use prettier, which
  reformats whole files.
- Never destructure methods off objects you then call.
- Follow `.agents/skills/contribute/SKILL.md`. The PR targets `dev`, and the PR
  body must fill the template (`.github/pull_request_template.md`). CI runs
  `scripts/verify-pr-contract.mjs` and fails when:
  - **Checks** lists no backticked command;
  - **Verification** lacks PASS/FAIL/INCONCLUSIVE or the word "evidence";
  - **Documentation** names no updated doc and has no "Documentation: not
    needed" line with a reason.

## Tests

Write each test first and watch it fail.

- `automation-detail-page.test.tsx`:
  - Runs is the default tab and lists runs newest first.
  - A row links to `/workflows/$id/runs/$runId`.
  - The empty state shows when there are no runs.
  - Settings shows the prompt and triggers.
- The new run page test:
  - Markdown renders: an `h2`, `strong`, and an `<a>` with `target="_blank"`.
  - One Decide card renders per analysis ID.
  - A failed run shows its error.
  - Steps render collapsed.
- The existing chat Decide card tests still pass after the move.

## Checks before the PR

- `pnpm run typecheck` in `apps/web`. This is the full script and it includes
  test files. `tsc -p tsconfig.json` alone misses test type errors, which CI
  catches.
- `pnpm exec vitest run` on `src/features/automations` and
  `src/features/chat/components`.
- `pnpm exec oxlint <changed files>` and `pnpm exec oxfmt --check <changed
  files>`.
- Live on `garden-dev`, after merge:
  1. Open Workflows, then "Decide test – sales report".
  2. Click **Run now**. The run appears at the top of Runs.
  3. Open it. The report is formatted, the chart opens, and the steps are
     listed.

## Out of scope

- Run notifications and toasts when a run finishes.
- Rerunning or editing from the run page.
- Google Drive input and the Weekly data report template. That is step 3 of
  `docs/features/decide-automations-spec.md`.
