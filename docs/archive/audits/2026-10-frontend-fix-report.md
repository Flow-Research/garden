# Garden Frontend Fixes (October 2026)

*October 24, 2026. Branch `frontend-audit`, from the audit commit `112e9193` to `d5cd2bcd`. Not pushed.*

All 29 Fix-first defects and all 13 action findings (A1–A13) are fixed. Most of the effects, UX and accessibility findings are fixed too. The work is 105 commits, one concern per commit. Nine new bugs turned up during the work (N1–N9): five are fixed, three are logged for later, and one already fails on `main`. The large refactors and design-system migrations are left, with reasons, in the amber section below. The issue-ordering change needs a database migration and was a deliberate decision (red section below).

| Area | Findings | Fixed | Partly fixed | Left |
| --- | --- | --- | --- | --- |
| Fix first (F) | 29 | 29 | 0 | 0 |
| Actions (A) | 13 | 13 | 0 | 0 |
| UX and accessibility (U) | 10 | 9 | 0 | 1 (needs a decision) |
| Effects and state (E) | 12 | 10 | 1 | 1 |
| Data layer and routing (D) | 14 | 1 | 7 | 6 |
| Styling (S) | 14 | 4 | 2 | 8 |
| Components (C) | 18 | 2 | 1 | 15 |

**Verification:**

- **Web tests:** the full suite (`apps/web`) has 751 passing tests and 1 failing. The failure, `-authorization.test.ts`, also fails on `main` (N4).
- **Package tests:** `packages/core` (65 tests) and `packages/server` (1) pass. `packages/db` (35) passes too, including the new migration test against real Postgres.
- **Typecheck and lint:** all seven `typecheck` steps pass, and the changed files add no lint warnings.
- **Browser:** nothing was run in a browser. Visual changes (dark mode, icon sizes, the drag overlay) and drag-and-drop behaviour should be checked by hand before merging.

> [!CAUTION]
> **Decision: issue order is stored as fractional-indexing keys (`7d0131ba`). This needs a database migration.**
>
> **Problem (N7):**
>
> - `issue.position` was an integer. Dropping a card between two neighbours sent their average, for example 3.5, and the API's integer schema rejected it, so the drop failed.
> - `createIssue` never set a position, so every new issue got 0 and tied with the others.
>
> **Options considered:**
>
> 1. **Float positions.** Smallest change, but repeated drops between the same two cards run out of float precision after about 50 moves, and then ties come back.
> 2. **Integer positions, renumbered on every move.** No migration, but one drop rewrites every card in the column, which is more writes and more chances for two people's moves to conflict.
> 3. **Fractional-indexing keys (chosen).** There is always a key between any two keys, so a move writes one row and never needs renumbering. There is no precision limit.
>
> **Decided by:** the user, on October 24, 2026, for reliability.
>
> **What changed:**
>
> - `issue.position` becomes `text COLLATE "C"`, default `'a0'`.
> - Migration `0058_issue_position_fractional_index.sql` keeps the existing order. Within each workspace, issues are ranked by their old position (ties broken by `created_at`, then `id`) and given the library's own key sequence. A test against real Postgres checks this.
> - `@garden/core/issues/order-key` wraps the library. The API accepts only valid keys. The board computes the key between its neighbours. `createIssue` adds new issues after the last key in their status.
>
> **Before deploying:**
>
> - The migration rewrites the `position` column of every issue, so run it in a maintenance window on large databases.
> - It has no down migration. Take a backup first.
> - Anything outside this repository that reads `issue.position` as a number (scripts, exports, analytics) must be updated, because it is now a string.

## Fix status by finding

Commits are on `frontend-audit`. "Partly" means the user-facing defect is fixed but not the whole recommendation; the amber section says what is left.

### Fix first

| ID | Commit | ID | Commit |
| --- | --- | --- | --- |
| F1 | `68905a9f` | F16 | `6b71d361` |
| F2 | `efb12c1c` | F17 | `118b3f04` |
| F3 | `d81fb8ec` | F18 | `9f14d02b` |
| F4 | `7d1106ee` | F19 | `34260734` |
| F5 | `035b3b0e` | F20 | `68ebdcce` |
| F6 | `ae3e3493` | F21 | `cdbbad87` |
| F7 | `3b180816` | F22 | `9add7879` |
| F8 | `a4820dbb` | F23 | `cae9561b` |
| F9 | `e87e6b0a` | F24 | `2575ac2b` |
| F10 | `5b30735e` | F25 | `47cfe7f9` |
| F11 | `48c3f620`, `83f5c5f6` | F26 | `c2b7f683` |
| F12 | `eb1d3d15` | F27 | `980682c8` |
| F13 | `0bda519c` | F28 | `f16e1fa1` |
| F14 | `9039fda1` | F29 | `7f12fb10` |
| F15 | `6872fbb6` | | |

### Actions, UX and accessibility

| ID | Status | Commit |
| --- | --- | --- |
| A1 | Fixed | `ccb14d5b` |
| A2 | Fixed | `53c06c97` |
| A3 | Fixed | `8aff3978` |
| A4 | Fixed | `20737c5d`, `792e7ecc` |
| A5 | Fixed | `eb1d3d15` |
| A6 | Fixed | `50b84399` |
| A7 | Fixed | `11cb7fe8` |
| A8 | Fixed | `dcfac6a0` |
| A9 | Fixed | `1e5a762a` |
| A10 | Fixed | `4baeda3a` |
| A11 | Fixed | `792e7ecc` |
| A12 | Fixed | `b974fccb` |
| A13 | Fixed | `0081501b` |
| U1 | Fixed | `1c5f612b` |
| U2 | Fixed | `ffa7bc7e` |
| U3 | Fixed | `abe98d40` |
| U4 | Fixed | `14bbc34e` |
| U5 | Fixed | `edf0d287`, `66cd9f37`, `b973a60e` |
| U6 | Fixed | `c9cb1dd4` |
| U7 | Left | Needs a naming decision |
| U8 | Fixed | `307d8751` |
| U9 | Fixed | `874ae63e` |
| U10 | Fixed | `5fcc5bff` |

**Low items fixed:**

- **Actions:**
  - toasts now wait for the result (`283121b0`)
  - infinite scroll retries and reports a failed page (`30002a18`)
  - a failed workspace switch is reported (`e2d05b83`)
  - chat Retry keeps attachments (`2d161220`)
  - reaction and subscription toggles report failures (`aab8feb3`)
  - skills actions no longer leak unhandled rejections (`db7381c6`)
  - automation run history polls while a run is in progress (`18cbec45`)
  - deleting an issue no longer refetches it (`5a7ed24f`)
  - a failed Open in chat returns to the issue (`dd69a99d`)
  - editing an hourly trigger's minute keeps the daily hour (`06f6b1b7`)
- **UX and accessibility:**
  - the workspace menu opens the Workspace tab, and the settings dialog has a title (`7ee60673`)
  - labels and names (`4010a9b1`)
  - contrast (`c31ea0f9`)
  - focus return and focus rings (`0a15d966`)
  - the Connections skeleton (`d05fdf0a`)
  - placeholder copy (`a1a5db00`)
  - the avatar upload spinner (`0f35d2ac`)
  - archived agents left out of the count (`8038c7c0`)
  - triggers described in words (`c5ea08a0`)
  - dialog max height (`45b57d1e`)

### Effects and state

| ID | Status | Commit |
| --- | --- | --- |
| E1 | Fixed | `bdf02b7f` |
| E2 | Fixed | `e85bc460` |
| E3 | Fixed | `582ab1dc` |
| E4 | Fixed | `d22b3bbc` |
| E5 | Fixed | `c7e3b0bd` |
| E6 | Fixed | `e6e21a6b` |
| E7 | Fixed | `c3609b45` (actions split from the location; the adapter itself is kept, see D6) |
| E8 | Fixed | `ff580cac` |
| E9 | Fixed | `b3e058b5` |
| E10 | Partly | `c2b7f683` (a cancelled or no-op drop resets the board) |
| E11 | Left | See amber section |
| E12 | Fixed | `80fc06f4` |

**Low items fixed:**

- the microphone is released on unmount (`d116f679`)
- the carousel listener is removed (`dbc6ccda`)
- "Copied" timers are cleared (`ac613182`)
- an issue's detail is fetched even when the list has a copy (`20d71dec`)
- infinite scroll re-observes its sentinel (`30002a18`)
- the skills editor store is deleted (`f7f3090a`)

### Data layer and routing

| ID | Status | Commit |
| --- | --- | --- |
| D1 | Left | See amber section |
| D2 | Partly | `fd83fced` (mentions no longer load the issue list), `0b12d674` (N8); the unread badge is left (N9) |
| D3 | Fixed | `5b21ba31` |
| D4 | Left | See amber section |
| D5 | Left | See amber section |
| D6 | Partly | `874ae63e` (agent tab and inbox filter in the URL); zod schemas and adapter removal are left |
| D7 | Left | See amber section |
| D8 | Partly | `3998c5ef` (members tab workspace id); domain hooks and `MutationCache` toasts are left |
| D9 | Left | See amber section |
| D10 | Partly | `609dafe8` (stable `useActorName`); virtualization is left |
| D11 | Partly | `e32f9ed8` (graph canvas and debug drawer lazy); Shiki is still eager |
| D12 | Partly | `1c5f612b` (default error component); the guard in `beforeLoad` is left |
| D13 | Left | See amber section |
| D14 | Partly | `3629750d` (nuqs removed); `fractional-indexing` is now used (`7d0131ba`); `react-table` is kept by request for a planned shared table |

### Styling

| ID | Status | Commit |
| --- | --- | --- |
| S1 | Left | See amber section |
| S2 | Fixed | `81b0182c`, `4010a9b1` |
| S3 | Fixed | `f68dba08` |
| S4–S6 | Left | See amber section |
| S7 | Fixed | `b5e3476e` |
| S8 | Left | See amber section |
| S9 | Partly | `d42c3200` (`no-scrollbar` defined); dead roadmap CSS and `--radius-card`/`--radius-panel` are left |
| S10 | Left | See amber section |
| S11 | Partly | `d5cd2bcd` (equal `h-N w-N` pairs become `size-N`, so Button keeps them); mixed fill/stroke icons are left |
| S12, S13 | Left | See amber section |
| S14 | Fixed | `8620a1fc` |

### Components

| ID | Status | Commit |
| --- | --- | --- |
| C3 | Fixed | `48c3f620` (shared `ConfirmDialog`), used in `83f5c5f6`, `8aff3978`, `db7381c6` and others |
| C9 | Partly | `ac613182` (one copy-to-clipboard hook) |
| C12 | Fixed | `f7f3090a` (about 770 lines deleted); `knip` in CI is left |
| C1, C2, C4–C8, C10, C11, C13–C18 | Left | See amber section |

## New bugs found while fixing

| ID | Bug | Status |
| --- | --- | --- |
| N1 | A failed document upload on a new chat kept the title and preview it had already saved, so /chats no longer offered the thread as new. | Fixed with F6 (`ae3e3493`) |
| N2 | Deleting an automation removed its cached page even when the delete failed, and refetched it after a successful one. | Fixed (`7849dbf7`) |
| N3 | Reactions are never saved. The reaction routes return a made-up reaction and store nothing; there is no reactions table. Reactions disappear on the next refetch. | Left: needs a table, a migration and a product decision |
| N4 | `src/routes/api/-authorization.test.ts` fails on `internal/executor/catalog.ts`. | Fails on `main` too; unrelated |
| N5 | Commit `6ea3eb7e` deleted the skills list and file tree, which caused F17. | Fixed with F17 (`118b3f04`); the leftover store is deleted in `f7f3090a` |
| N6 | Comments an agent posts through the runtime publish no realtime event, so other viewers see them only through the run refresh. | Left: server-side change |
| N7 | Board drops between two cards were rejected, and new issues all got position 0. | Fixed (`7d0131ba`); see the red section |
| N8 | The dashboard's inbox count and preview counted raw events, so they disagreed with the sidebar badge, which counts threads. | Fixed (`0b12d674`) |
| N9 | `/api/inbox/unread-count` counts events, not threads. | Left: blocks the D2 badge change, see amber section |

> [!WARNING]
> **Left for later, and why.**
>
> These items were not done in this pass. Most are app-wide refactors or design decisions. Done without design agreement and browser testing, they are likely to cause new bugs, and the audit's user-facing defects are already fixed without them. Each group says what it needs before it starts.
>
> **1. Architecture changes: they need an agreed design and a staged migration.**
>
> - **D1, E11, D12 (rest), D14 (rest): route context and SSR.** These move auth, workspace and user data from zustand into `beforeLoad` route context and wire `@tanstack/react-router-ssr-query`. Every page and the shell depend on that data. The change needs SSR checks in a running app, which this pass could not do.
> - **D4, D5: one API transport and shared types.** This touches about 117 call sites, across the zod, Effect Schema and Effect `HttpApiClient` clients. It needs agreement on one schema library first, because the server contracts use more than one.
> - **D6 (rest): zod search schemas and removing the navigation adapter.** This covers 12 routes and every `useNavigation` consumer. E7 removed the adapter's performance cost, so what remains is consistency work.
> - **D9: query keys and a finite default `staleTime`.** Changing the global `staleTime: Infinity` changes when every screen refetches. It should be rolled out with named constants and checked screen by screen.
> - **D8 (rest), C4: domain mutation hooks and `MutationCache` toasts.** This moves 37 inline mutations and 168 toasts. It is best done with the component splits below, one domain at a time.
> - **D13: one pattern for forms and dialogs.** Moving to TanStack Form plus one dialog store touches every form. It should come after D8.
>
> **2. Component splits: pure refactors with high regression risk.**
>
> - **C1, C2, C5–C8, C13, C15 and C17** split the large components (`files-page`, `skills-page`, the inbox reply box, `chat-panel-controller`, the automation forms, `comment-card`, `inbox-page`, `issue-detail`).
> - Their user-facing bugs are fixed. What is left changes structure, not behaviour, across 500 to 1,500-line files. Each should be its own PR, with tests written first and a check in the browser.
> - **C5** (the reply box's controls that do nothing) also needs a product call: build them properly, or remove them.
>
> **3. Design-system work: it needs a designer's decision and a visual review.**
>
> - **S1:** pick one colour vocabulary. The two scales render different greys, so a codemod over about 230 files changes how text looks everywhere.
> - **S4, S5, S6, S8, S10:**
>   - the typography scale and the `PageTitle`/`SectionLabel` components
>   - glass `Card` and `Table`
>   - Button, Badge and Input variants and one focus ring
>   - shadow and radius scales
>   - one markdown typography
>
>   Each one changes how the product looks.
> - **S12, S13:** z-index tokens and moving raw colours to tokens. `tokens.css` is generated from Tokens Studio, so new tokens belong in the design source, not in hand edits.
> - **S9 (rest), S11 (rest), C9 (rest), C10, C16, C18:**
>   - dead roadmap CSS
>   - mixed icon styles
>   - one markdown pipeline
>   - re-implemented primitives
>   - shared pickers and status badges
>   - shared layouts
>
>   These are best done together with the design-system work above.
>
> **4. Needs a product decision.**
>
> - **U7: naming.** The navigation says Tasks, Workflows and Connectors; pages say Issues, Automations and Connections. Someone has to choose the terms.
> - **N3: reactions are not saved.** Decide whether reactions should exist. If yes, add a table and a migration. If not, remove the reaction UI.
>
> **5. Deferred because the obvious fix would break something.**
>
> - **D2 (unread badge), N9:**
>   - The unread-count endpoint counts events, while the badge counts threads, so the number shown would change.
>   - The action-required toasts read the polled inbox list, so they would stop.
>   - Needed first: an endpoint that counts threads, and a new trigger for the toasts, such as realtime.
> - **D7: writes inside queries in the chat runtime.**
>   - The warm-session claim and runtime warm-up are deliberate queries with `staleTime: Infinity`.
>   - The code comments describe a websocket reconnect storm seen in smoke tests. Rewriting them needs the agent runtime running to check.
> - **E10 (rest):**
>   - The board's columns are still mirrored by an effect, which costs one extra render per update. The stale-board bug is fixed.
>   - Rewriting the drag state is not worth the risk without testing drag-and-drop by hand.
> - **D10 (rest), D11 (rest):** virtualizing the board and list, and lazy-loading Shiki. These need performance measurements first, to show they are worth it.
> - **C11: import cycles and cross-feature imports.** Moving shared components out of `features/issues` touches about 113 imports. It should land together with the lint rule that stops new cycles.
> - **N6: realtime events for agent comments.** This is a server and runtime change, outside a frontend pass.
>
> **6. Enforcement rules.**
>
> - These are the lint rules to error (`exhaustive-deps`, the `jsx-a11y` rules, deep imports), `knip` in CI, a Tailwind class lint and an axe smoke test.
> - Turned on now, they would fail CI on hundreds of existing violations, most of them in the work listed above. Add each as a warning, then raise it to error as its area is cleaned up.
>
> **7. Low items not addressed.**
>
> - **Effects:**
>   - closing the mobile sidebar and resetting state on close still use effects
>   - code blocks are highlighted twice, and their cache is unbounded
>   - the bubble menu uses refs as state
>   - `useLoadMoreDoneIssues` reads the cache during render
>   - `matchMedia` re-subscribes on every render
>   - create-issue writes every field to two places
> - **Actions:** Resume issue reports a failure when only the archive step failed.
> - **UX:**
>   - the workspace menu's header always reads "Garden", and two of its items go to the same place
>   - agent status is shown by colour only
