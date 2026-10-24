# Garden Frontend Audit (October 2026)

*October 22, 2026. Audited at upstream `dev` commit `edb7510`.*

> [!NOTE]
> Fix status for every finding, the new bugs found while fixing, and what was left and why are in [2026-10-frontend-fix-report.md](2026-10-frontend-fix-report.md).

## Summary

The frontend works on its main paths, but it has confirmed defects that lose user data or leave actions stuck, plus a large consistency debt. Seven independent passes found 184 issues. About 25 were found by more than one pass, which leaves roughly 160 distinct issues. 29 of them are user-facing defects to fix first (Fix first, below).

| Area | Health | Headline |
| --- | --- | --- |
| Data safety in editors and forms | At risk | Saving a skill can delete all its supporting files. An inbox reply can be posted to the wrong issue. Description edits, and comments that fail to send, are silently lost. |
| Actions and async flows | At risk | Approvals and chat sends can fail with no message or hang "thinking". Several destructive actions have no confirmation. Confirm buttons accept double clicks. |
| Effects and state | Needs work | Props are copied into state and re-synced by effects, which overwrites in-progress edits. Side effects run during render. Every run event triggers a burst of refetches. |
| Data layer and routing | Needs work | Failed requests are cached as empty data. Realtime updates miss comments and other issue sub-resources. SSR and route prefetch do nothing on a hard load. There are seven ways to call the API. |
| Components | Needs work | 24 components exceed 500 lines. There are 12 hand-built confirm dialogs, 4 markdown pipelines and about 1,100 lines of dead code. |
| Styling | Needs work | Two colour vocabularies resolve to different greys. Status colours are swapped between views. There are 275 arbitrary font sizes, and status pills fail contrast in dark mode. |
| UX and accessibility | Needs work | Loading and errors look like empty data. Chat goes blank on errors. Multi-select is mouse-only. The shell has no small-screen layout. The same features have different names on different screens. |

**Fix these five first:**

1. The skill editor deletes supporting files on save (F1).
2. An inbox reply goes to the wrong issue (F2).
3. Typing a digit answers the agent's question (F3).
4. Edits are lost on navigation or a failed send (F4, F5).
5. The chat hangs after approving a proposal (F7).

Each of these is a small, contained fix.

**Method:**

- The audit was read-only, at upstream `dev` commit `edb7510`. It covered 481 files and about 75,600 lines in `apps/web/src` (excluding API routes and server code) and `packages/ui`.
- Seven passes ran in parallel: effects and state; components and duplication; styling; actions and mutations; UX and accessibility; correctness; data layer and routing.
- The highest-severity findings in each pass were re-checked against the source.
- Nothing was run in a browser, so findings that depend on runtime behaviour are marked *Likely*.
- As in the first audit, the repository's agent instruction files were not used. The code was judged on its own terms.

## Fix first

These 29 defects affect users directly. Each was confirmed by reading the code, except F29, which depends on timing. Paths are relative to `apps/web/src` unless they start with `packages/`. Line numbers are accurate to ±2.

| # | Severity | Defect | Location | Fix |
| --- | --- | --- | --- | --- |
| F1 | Critical | **Saving a skill can delete all its supporting files.** The editor seeds its file list from the skill list, where `files` is always `[]`. When the full skill loads, the bundle key is unchanged, so local state never re-syncs and the editor is dirty at once. Save then sends `files: []`, and the server replaces the bundle. | `features/skills/components/skills-page.tsx:368-445`; server `lib/server/skills-service.ts:363-397` | Mount the editor only after the full skill loads, keyed by `id:bundle_hash`. Send `files` only when they changed. |
| F2 | High | **An inbox reply is posted to the wrong issue.** The reply box is an uncontrolled contentEditable that is not keyed by thread. Text typed in thread A survives a switch to thread B and is sent to B's issue. | `features/inbox/components/inbox-details/inbox-notification-detail/inbox-notification-detail-v2.tsx:167`; `features/inbox/components/inbox-page.tsx:518-534, 649` | Key the detail pane (or the reply input) by thread id. |
| F3 | High | **Typing a digit answers the agent's question.** A document-level keydown handler ignores inputs and textareas but not contentEditable. While a run waits for input, typing "2" in the description, a comment or the inbox reply submits option 2. | `features/issues/components/question-card.tsx:125-145` | Skip editable targets. Share one `useOptionHotkeys` with `structured-input-panel.tsx`, which already guards correctly, and scope it to focus within the card. |
| F4 | High | **Description edits are lost on navigation.** The 1.5 s debounced save is cancelled on unmount, so switching issue or leaving within that window drops the last edits. | `features/editor/content-editor.tsx:203-208`; `features/issues/components/issue-detail.tsx:594-604` | Flush the pending save on unmount and on blur. |
| F5 | High | **Comment, reply and edit text is lost when sending fails.** The submit helpers catch the error and resolve normally, so the inputs clear and edit mode closes anyway. | `features/issues/hooks/use-issue-timeline.ts:27-71`; `comment-input.tsx:45-63`; `reply-input.tsx:85-103`; `comment-card.tsx:212-228` | Return success or rethrow, and clear only on success. |
| F6 | High | **A chat message and its attachments are lost when an upload fails.** The composer clears before sending, and an upload failure only logs to the console. | `features/chat/components/composer/composer.tsx:484-492`; `chat-panel-controller.tsx:415-428` | Restore the draft and show the error in the timeline. |
| F7 | High | **The chat hangs after approving a proposal.** If `agent.call` rejects, the card is already marked resolved, the spinner never clears and the turn never resumes. Retry is blocked. | `features/chat/use-tool-approvals.ts:105-120`; `chat-runtime-provider.tsx:330-334` | Use try/finally, show the error, and offer Retry. |
| F8 | High | **Duplicate "New Chat" threads.** The claim effect depends on the `useMutation` result, which changes every render, so it re-runs and POSTs repeatedly. A second claim path runs through `useQuery`. | `features/chat/components/agent-interaction-screen.tsx:153-164`; `chat-runtime-provider.tsx:107-165` | Have one owner with an in-flight guard, and dedupe on the server. |
| F9 | High | **Work-product Apply and Approve can be sent twice; failures are silent on the issue page.** Apply posts to the connector, for example GitHub. | `features/issues/components/work-product-card.tsx:233-256`; `issue-run-surface.tsx:216-247` | Disable while pending, toast on error, and confirm Apply. |
| F10 | High | **Deleting an automation or a trigger takes one click, with no confirmation or pending state.** | `features/automations/automation-detail-page.tsx:352-360, 648-662, 826-829` | Use a confirm dialog with a pending state. |
| F11 | High | **Confirm buttons accept double clicks.** `AlertDialogAction` is a plain `Button`. Five dialogs don't disable it while the action runs: batch delete, comment delete, delete team, remove member or revoke invite, and leave workspace. Batch delete then shows "Failed to delete issues" after a successful delete. | `packages/ui/components/ui/alert-dialog.tsx:144-155`; `features/issues/components/batch-action-toolbar.tsx:135-140` and others | Add a shared `ConfirmDialog` with a built-in pending state (C3). |
| F12 | High | **An agent's question or approval stays hidden when the run starts waiting.** The panel's open state is fixed at mount. | `features/issues/components/active-run-panel.tsx:295-301` | Derive open from the run status unless the user toggled it. |
| F13 | High | **The connector drawer can't be closed after an OAuth callback.** An effect reopens it from `connector_id` in the URL. | `features/connections/components/connections-page.tsx:249-261` | Keep the drawer state in the URL and clear it on close. |
| F14 | High | **Failed requests are cached as empty data.** Timeline, children, reactions, subscribers, run events and usage return `[]` (or zeroes) on error. With the global `staleTime: Infinity`, a blip shows "no comments" until reload. | `lib/issues/queries.ts:58, 260, 273, 289, 302, 313-320`; `packages/app-state/src/query-client.ts:7` | Throw from the query function, and handle `isError` with Retry. |
| F15 | High | **Realtime never refreshes comments and other issue sub-resources.** Their keys (`['issues', 'timeline', id]` and similar) sit outside the `['issues', wsId]` prefix that realtime invalidates. Other people's comments on an open issue don't appear. | `lib/issues/queries.ts:6-27`; `lib/realtime/invalidation.ts:17-22` | Nest the keys under the issue detail key, publish comment events, and use a finite default `staleTime`. |
| F16 | High | **Refetch storm during agent runs.** Every run event (polled every 2 s) invalidates six query families, including the full issue list and the inbox. | `features/issues/components/issue-run-surface.tsx:275-299` | Invalidate only on status transitions. |
| F17 | High | **The Skills page can't switch skills or add one.** Once the library is non-empty it shows only the first skill. There is no list, Add button or file tree. | `features/skills/components/skills-page.tsx:177-182, 317-334` | Add a skills list with Add, and put the selection in the URL. |
| F18 | High | **The selected Issues scope tab is unreadable.** `text-text-brand-onBrand` is not a defined utility, so the label stays dark on the brand fill (about 1.2:1). | `features/issues/components/issues-header.tsx:163` | Use `text-text-brand-on-brand`. |
| F19 | High | **Board card links lead to a 404 and swallow Cmd-click.** `href` is `/issues/<id>`, but the route is `/tasks/$issueId`. | `features/issues/components/board-card.tsx:283-303` | Use `issuePath()`, and skip `preventDefault` when a modifier key is held. |
| F20 | High | **Loading and errors look like empty data, and chat goes blank.** This affects inbox, files, members, agents, automations and skills. Chat renders nothing while loading, for an unknown thread or on failure. | `features/inbox/components/inbox-page.tsx:352, 602`; `features/brain/components/files-page.tsx:831`; `features/settings/components/members-tab.tsx:255`; `features/agents/components/agents-page.tsx:37`; `features/automations/automations-page.tsx:1066`; `features/skills/components/skills-page.tsx:161`; `features/chat/components/agent-interaction-screen.tsx:159-174` | Show a skeleton when pending, then a message with Retry on error, then the empty state. |
| F21 | High | **The shell is unusable on small screens.** The 240 px sidebar never collapses, the settings nav is a fixed 256 px, and the toolbars don't wrap. | `packages/ui/components/shell/app-sidebar.tsx:73`; `features/settings/components/settings-page.tsx:54`; `features/issues/components/issues-header.tsx:150` | Use an off-canvas sidebar below `md`, stack the settings nav, and let toolbars wrap. |
| F22 | High | **The PDF preview duplicates pages and leaks memory on zoom.** Cancellation is checked once, before the page loop, and the document is never destroyed. | `features/artifacts/document-artifact.tsx:216-310` | Check cancellation in the loop, cache the document, and destroy it on cleanup. |
| F23 | High | **Status colours are swapped between views and unreadable in dark mode.** In review and Done use opposite icon and badge colours. White text sits on tokens that flip to light colours in dark mode (about 1.6:1). | `packages/core/src/issues/config/status.ts:53-83`; `features/issues/components/board-column.tsx:18-25`; `features/dashboard/dashboard.server.ts:83-96`; `features/issues/components/list-view.tsx:213` | Add status fill and on-fill tokens, and use them everywhere. |
| F24 | Medium | **Clearing a description never saves.** `md \|\| undefined` drops the key from the request body. | `features/issues/components/issue-detail.tsx:599-601` | Send the empty string. |
| F25 | Medium | **Edit forms overwrite what the user is typing.** Effects copy props into state, so a refetch or avatar upload resets the fields. This affects the automation edit dialog, account name and workspace fields. | `features/automations/automation-detail-page.tsx:385-395`; `features/settings/components/account-tab.tsx:79-81`; `workspace-tab.tsx:52-56` | Mount the form on open, keyed by id, and keep a separate draft. |
| F26 | Medium | **Pressing Esc mid-drag freezes the kanban board.** There is no `onDragCancel`, so the board stops syncing and the card stays in the wrong column. | `features/issues/components/board-view.tsx:302-308` | Add `onDragCancel` that resets the drag state. |
| F27 | Medium | **Inbox "Connect" gets stuck on "Waiting for authorization" and polls every 1.5 s forever.** | `features/inbox/components/inbox-control-plane.tsx:209-254` | Reset when the popup closes, on success, or after a timeout. |
| F28 | Medium | **Editor upload failures are silent, and sending during an upload attaches the file to the next comment.** | `packages/app-state/src/hooks/use-file-upload.ts:43-53`; `features/issues/components/comment-input.tsx:37-63` | Add a default error toast, and block submit while `hasActiveUploads()`. |
| F29 | Medium (Likely) | **The chat queue is shared across threads.** Switching thread mid-turn can send a queued message to the wrong thread or skip the queue. | `features/chat/components/chat-panel-controller.tsx:280-291, 526-552` | Key the controller by `sessionId`. |

## Findings by area

This section lists the issues that are not in Fix first. IDs carry an area prefix: E (effects and state), C (components), S (styling), A (actions), U (UX and accessibility), D (data layer and routing).

### Effects and state

Most of the data-loss bugs share one root cause. Props or query data are copied into state and then re-synced with an effect or render-phase code (8 sites, including F1 and F25). The codebase avoids `useEffect`, but its substitutes are less safe (7 sites):

- side effects scheduled from render with `queueMicrotask`
- `useQuery` used to run writes
- `useSyncExternalStore` used as a mount effect

| ID | Severity | Finding | Location | Fix |
| --- | --- | --- | --- | --- |
| E1 | Medium | The document editor iframe reloads mid-edit when its snapshot query refetches, losing cursor and undo (Likely). | `features/artifacts/workspace-docs-editor.tsx:113-193` | Capture the initial snapshot once, and stop this query refetching. |
| E2 | Medium | The reasoning block can't be collapsed while streaming; an effect reopens it immediately. | `components/ai-elements/reasoning.tsx:98-103` | Auto-open only when streaming starts. |
| E3 | Medium | The chat text preview is fetched in an effect: old content shows after a URL change, an earlier error never clears, and nothing is cached. | `features/chat/components/chat-document-panel.tsx:415-442, 557` | Use `useQuery`, and key the side panel by view. |
| E4 | Medium | The always-mounted command palette subscribes to the full issue list even when closed, and re-renders on every issue change. | `features/search/search-command.tsx:174-184` | Query only while open. |
| E5 | Medium | The recent-visits store (persisted to localStorage) is rewritten on every issue update. | `features/issues/hooks/use-issue-detail-data.ts:60-65` | Depend on the issue id only. |
| E6 | Medium | The link-hover guard reads the editor selection during render, so the value is stale and hover cards cover the bubble menu. | `features/editor/content-editor.tsx:248-250` | Read the selection at event time. |
| E7 | Medium | The navigation context changes on every URL change and re-renders every consumer, including each comment body. | `platform/navigation.tsx:12-41` | Delete the adapter and use TanStack hooks (D6). |
| E8 | Medium | The debug stream hand-rolls a cache mirrored into state. Read errors are unhandled, so spinners last five minutes. | `features/settings/components/use-debug-stream.ts:224-335` | Use `useSyncExternalStore` or a query, and catch read errors. |
| E9 | Medium | Issue search fetches outside TanStack Query with no cache. A default `excludeIds = []` defeats `useCallback`. | `features/issues/hooks/use-issue-search.ts:12-95` | Use the existing `issueSearchOptions` with a debounced value. |
| E10 | Medium | Board columns are mirrored from props by an effect. This causes a double render per update, and the board stays stale after a no-op drop. | `features/issues/components/board-view.tsx:165-175` | Derive the columns with `useMemo`, plus a drag-override state. |
| E11 | Medium | The auth layout runs side effects during render, and adds its provider after hydration, which remounts the whole shell. | `routes/_authenticated.tsx:93-150` | Hydrate in `beforeLoad` or the loader, and always render `WorkspaceIdProvider`. |
| E12 | Medium | The structured-question panel schedules timers and submits inside a `setState` updater, and isn't keyed per tool call. | `features/chat/components/structured-input-panel.tsx:56-83` | Compute outside the updater, and key the panel by `toolCallId`. |

**Low:**

- **Mobile sidebar:** the sidebar is closed through an effect on mobile, which can flash (`issue-detail.tsx:164`).
- **Reset on close:** state is reset in effects (`search-command.tsx:222`, `issue-picker-dialog.tsx:36`, `issues-page.tsx:212`).
- **Code highlighting** (`components/ai-elements/code-block.tsx:128-414`):
  - each snippet is highlighted twice
  - the cache is unbounded
  - cache keys can collide
- **Microphone:** it stays on if the component unmounts during `getUserMedia` (`speech-input.tsx:194-254`).
- **Refs used as state** in the bubble menu (`bubble-menu.tsx:487-519`).
- **Question-card listener:** re-subscribed on every render.
- **`useLoadMoreDoneIssues`:** reads the cache during render (`lib/issues/mutations.ts:92-133`).
- **`matchMedia`:** re-subscribed on every render (`inbox-page.tsx:39-50`).
- **Infinite scroll:** the observer doesn't fire again while the sentinel stays visible (`connections-page.tsx:235-248`, `infinite-scroll-sentinel.tsx:16-27`).
- **Carousel:** the `reInit` listener leaks (`packages/ui/components/ui/carousel.tsx:94-117`).
- **"Copied" timers:** four are never cleared.
- **Skills editor store:** never cleared (`skills-page.tsx:479-483`).
- **Issue detail:** never fetched when it was seeded from the list, because of `staleTime: Infinity` (Likely) (`use-issue-detail-data.ts:55-58`).
- **Create issue:** every field is written to both local state and the draft store (`create-issue.tsx:115-176`).

### Components and duplication

24 components exceed 500 lines. The largest mix data fetching, mutations, business logic and several views (sizes are charted in the Appendix). Duplication is the bigger cost, because every fix has to be made in several places, and the copies have already drifted apart.

| ID | Severity | Finding | Location | Fix |
| --- | --- | --- | --- | --- |
| C1 | High | **`files-page.tsx` is a god component.** It has 1,061 lines, 11 `useState` and 8 inline mutations. Three early-return views each repeat the hidden file input, the preview dialog and the upload dialog, and the delete dialogs differ between views. | `features/brain/components/files-page.tsx:171-967` | Split into `useBrainFileMutations`, `useBrainUploadFlow`, one `<BrainModals>` mounted once, and `<FilesOverview>`. |
| C2 | High | **`skills-page.tsx` is a 1,514-line file.** It holds 16 components, 14 `useState`, 12 store selectors and 5 inline mutations. It writes during render, drills props four levels (11 props, 5 of them booleans), and uses `useDeferredValue` as if it were a debounce. | `features/skills/components/skills-page.tsx` | Split into `skills/mutations.ts`, `SkillWorkspace` with `useSkillBundleDraft`, an `AddSkillDialog/` folder and `SkillPreviewPage`. |
| C3 | High | **There are 12 hand-built confirm dialogs.** Destructive styling and pending handling differ between them (see F11). | `files-page.tsx:986, 1031`; `folder-detail.tsx:333`; `batch-action-toolbar.tsx:119`; `comment-card.tsx:98`; `issue-detail.tsx:462`; `todo-agent-hint-dialog.tsx:24`; `members-tab.tsx:475`; `workspace-tab.tsx:202`; `skills-page.tsx:1333, 1382`; `team-dialogs.tsx:344` | Add `<ConfirmDialog tone="destructive" onConfirm={async}>` to `packages/ui`, with built-in pending state. |
| C4 | High | **The same server mutations are written twice, with different cache invalidation.** These are `reviewWorkProduct`, `resolvePermissionRequest` and `archiveInbox`. There are also 33 inline `useMutation` calls in 9 component files. Approving from the inbox and approving from the issue page leave different caches stale. | `features/issues/components/issue-run-surface.tsx:215-340`; `features/inbox/components/inbox-control-plane.tsx:155-364` | Move them into domain hooks in `lib/<domain>/mutations.ts`. |
| C5 | High | **The inbox reply box is a fourth editor.** Its formatting toolbar, attachment button, options button and model picker do nothing, because the reply sends `textContent`. That also drops line breaks. Dictation keeps only the last sentence, and Enter doesn't send. | `features/inbox/components/inbox-details/inbox-notification-detail/inbox-reply-input.tsx` (559 lines) | Rebuild it on `ContentEditor` or a plain textarea, reuse `SpeechInput`, and remove the dead controls. |
| C6 | Medium | **`chat-panel-controller.tsx` mixes too much.** It holds the send pipeline, inline LLM prompt assembly, a message queue and panel state, and imports the settings debug drawer. | `features/chat/components/chat-panel-controller.tsx:118-876` | Split into `turn-context.ts`, `useChatMessageQueue`, `useOptimisticPendingTurn` and `useDocumentPanel`. Move the debug code to `chat/debug/`. |
| C7 | Medium | **Automation forms are duplicated and inconsistent.** The create dialog is 530 lines and writes to the store during render. Its execution-config logic sits in a click handler. The edit form is a separate copy with different agent pickers and raw inputs. | `features/automations/automations-page.tsx:273-802`; `automation-detail-page.tsx:373-515` | Use one shared `<AutomationForm>`, plus `buildExecutionConfig()` and a templates file. |
| C8 | Medium | **Comment editing is duplicated.** It is copied inside `comment-card.tsx`, and again across the comment and reply inputs. | `features/issues/components/comment-card.tsx:171-374` vs `:380+`; `comment-input.tsx`; `reply-input.tsx` | Add `useCommentEditor`, `<CommentActionsMenu>` and one `<IssueCommentComposer variant>`. |
| C9 | Medium | **Rendering and preview code is duplicated.** The same comment renders differently on different surfaces. There are 4 markdown or code pipelines (`@garden/ui/markdown`, `ReadonlyContent`, Streamdown and Shiki), 5 copy buttons, 6 raw clipboard calls (4 unguarded), 2 image lightboxes, 2 file-preview dialogs and 3 file-type detectors. | `features/editor/readonly-content.tsx:17-75`; `components/ai-elements/code-block.tsx`; `features/chat/components/chat-document-panel.tsx:118, 231, 327`; `features/brain/components/file-preview-dialog.tsx` | Use one sanitizer and `MarkdownBase`, plus `<CopyButton>`, `<ImageLightbox>`, `<FilePreviewDialog>` and `getFileKind()`. |
| C10 | Medium | **Primitives from `packages/ui` are re-implemented.** These include a dialog (the inbox drawer, which has no focus trap), tabs (`files-page.tsx:761`, `xlsx-file-preview.tsx:85`), native checkboxes and a native select, five `animate-pulse` skeletons, a copied `LiveDot`, a second drop zone in the composer, and `useIsDesktop`. Meanwhile `progress`, `scroll-area` and `accordion` in ui have no users. | `features/inbox/components/inbox-page.tsx:711-741` and others | Replace each with the ui primitive. Add `useMediaQuery` and `<SegmentedControl>`. |
| C11 | Medium | **Features import each other's internals, with import cycles.** There are 113 cross-feature imports, 93 of them into internals. Cycles: issues with modals, common, projects, teams, chat and editor; chat with settings. The issues barrel is part of a cycle through `modals/create-issue`. `features/common` depends on `issues`. | `features/*` | Move shared pieces (`ActorAvatar`, `StatusIcon`, `PropertyPicker`, `IssueMentionCard`) to `components/` or `packages/ui`. Expose a public `index.ts` per feature, and lint-ban deep imports. |
| C12 | Medium | **About 1,100 lines of dead code.** Orphan files: the inbox v1 header, list item and detail; `agent-capability-popover.tsx` (191 lines); `agent-onboarding-hint.tsx` (153 lines); `use-run-lifecycle-toasts.ts` (168 lines). Unused exports: dashboard and issue-detail skeletons and fixtures, 4 bulk-inbox hooks, and about 40 vendored `ai-elements` exports. 7 of the 11 boneyard skeletons are never rendered. | See the Appendix | Delete them, and add `knip` to CI. |
| C13 | Medium | **Create-issue state and some props are passed through many layers.** `onCreateIssue(data?: Record<string, unknown>)` and lookup maps are drilled four levels. `CreateIssueModal` is mounted in 5 pages, each with its own copied state and an untyped payload. Chat approval state is drilled through `ChatTimeline` (16 props). | `features/modals/create-issue.tsx:87`; `features/issues/components/issue-detail.tsx:186-203`; `issues-page.tsx:173-188`; `features/teams/components/team-detail.tsx:185-205` | Add a `useCreateIssueModal()` store with a typed intent, a `BoardContext` and a `ToolApprovalContext`. |
| C14 | Medium | **Helpers are duplicated.** There are 5 copies of initials, 42 copies of `x instanceof Error ? x.message : ...` (though `lib/api/errors.ts` has the helper), 7 owner/admin checks, 10 `!agent.archived_at` filters, 2 CSV exports, and 2 OAuth popups with different completion detection. A second `normalizeHref` has no `javascript:` blocklist. | `features/inbox/components/inbox-compose-body.tsx:366` and others | Add shared helpers (`getInitials`, `errorMessage`, `normalizeUrl`, `downloadCsv`) and hooks (`useWorkspacePermissions`, `useActiveAgents`, `useConnectorOAuth`). |
| C15 | Medium | **`inbox-page.tsx` is a god component.** Gmail pagination is manual, ternary chains run 3–4 levels deep, there are three layout branches, and a 185-line SVG is inlined. | `features/inbox/components/inbox-page.tsx:56-765` | Split into `useInboxSelection`, `useGmailList` (`useInfiniteQuery`), `<InboxListBody>` and `<InboxDetailPane>`. |
| C16 | Medium | **Pickers and status displays are duplicated.** There are 9 agent and member picker lists, connector status is shown 3 ways (the dashboard shows the raw `setup_required`), and run and automation status have 4 configs. | `features/issues/components/issue-actions-menu.tsx:140-190`; `features/teams/components/create-team-dialog.tsx:172-190`; `features/dashboard/components/dashboard-page.tsx:797-805` | Add `<ActorOptionList>`, `<ConnectorStatusBadge>` and `<StatusBadge>`. |
| C17 | Medium | **`issue-detail.tsx` is a single 902-line component.** It has 11 `useState` and about 560 lines of JSX. | `features/issues/components/issue-detail.tsx:119-902` | Split into Header, Description, SubIssues and Activity sections, plus `useCommentHighlight` and `useDeleteIssue`. |
| C18 | Low | **Shared layouts are re-typed by hand.** There are 6 custom empty states (though ui `Empty` exists), 13 hand-rolled page headers (though `PageHeader` exists) and 3 search-input patterns. Chat feedback thumbs store only local state. | `features/chat/components/chat-timeline.tsx:134-156` and others | Use `Empty`, `<PageHeader>` and `<SearchInput>` everywhere. Wire up or remove the feedback buttons. |

### Styling and design system

The tokens themselves are in good shape: light and dark define the same 142 semantic tokens, and no class string contains conflicting utilities. The problem is that the code bypasses them. There are two colour vocabularies, a typography system with almost no users, and missing component variants that push styling into one-off overrides.

| ID | Severity | Finding | Location | Fix |
| --- | --- | --- | --- | --- |
| S1 | High | **Two colour vocabularies resolve to different values.** Neighbouring text renders in visibly different greys, and 7 files mix both scales. For secondary text, `text-muted-foreground` is #5a5a5a (796 uses) while `text-text-secondary` is #757575 (72 uses). For primary text, `text-foreground` is #303030 (309 uses) while `text-text-default` is #1e1e1e (25 uses). `bg-muted`, `bg-accent` and `bg-background-main-secondary` are the same colour under three names. Tertiary text is improvised with 8 opacity levels. | 59 files use the long names, 168 use the shadcn names | Pick one vocabulary and add tertiary/subtle aliases. Codemod the rest and lint-ban the other names. |
| S2 | Medium | **Dark mode breaks in several places.** The inbox filter hover is `hover:text-gray-900` (near-black on dark). The "New" pill is a light-only emerald. PDF page controls are `bg-white/80` under a light icon. A drop shadow uses a parchment-brown rgba. `hsl(var(--muted))` is invalid because the token is hex, so the gradient never renders. | `features/inbox/components/inbox-headers/inbox-header-v2.tsx:66`; `inbox-list-item-v2.tsx:91`; `features/artifacts/document-artifact.tsx:374-395`; `features/chat/components/chat-panel-controller.tsx:774`; `routes/_authenticated/invitations/$id.tsx:161` | Use the badge, scrim and shadow tokens, and `var(--muted)`. |
| S3 | Medium | **Dialog sizing fights the primitive.** Team dialogs ask for 32–36rem, but `DialogContent`'s `sm:max-w-sm` caps them at 384 px. There are about 48 `!` overrides in 14 files (20 in `create-issue.tsx` alone), and 15+ different max-widths. | `features/teams/components/team-dialogs.tsx:117, 199, 268`; `create-team-dialog.tsx:124`; `packages/ui/components/ui/dialog.tsx:62` | Add a `size` variant to `DialogContent` and remove the `!` overrides. |
| S4 | Medium | **The typography system is defined but bypassed.** The 13 composite utilities (`heading-*`, `body-*`, `caption`) are used 5 times in total, and `font-heading` has 0 uses. There are 275 arbitrary font sizes across 22 values; `text-[11px]` alone appears 99 times. Page titles use 7 different styles, and eyebrow labels use 5 sizes and 9 letter-spacings. `font-medium` (500) appears 294 times, but the tokens define only 400, 600 and 700. | Hotspots: `environment-debug-drawer.tsx` (46), `roadmap-page.tsx` (28), `automations-page.tsx` (23) | Add `<PageTitle>` and `<SectionLabel>`, and add 10/11 px steps to the scale. Lint `text-[Npx]`. |
| S5 | Medium | **Class strings are repeated where a component exists, or should.** The dashboard rebuilds the same "glass" card shell 13 times. The `h-12 border-b` header bar is hand-rolled 13 times, though `PageHeader` exists. There are 7 search-field styles. There is no ui `Table`, so table headers are copied by hand, and `Card` is used in only 4 files. | `features/dashboard/components/dashboard-page.tsx` and others | Add a `Card variant="glass"`, and use `PageHeader`. Promote `SearchField` and a `Table` to `packages/ui`. |
| S6 | Medium | **Missing variants push styling into overrides.** There are 132 raw `<button>` elements outside ui. The same Button override is repeated 5 times, and Badge text is overridden to 10 px 13 times. Input comes in three heights, and some forms use raw inputs. There are 6 focus-ring recipes, and `outline-none` is used with no replacement focus style. | `features/automations/automation-detail-page.tsx:436, 448, 571`; `trigger-config.tsx:184-227`; `features/issues/components/list-view.tsx:161, 210`; `packages/ui/components/shell/surface-tabs.tsx:68` | Add Button `size="toolbar"`, Badge `size="sm"` and Input sizes, and use one focus-ring recipe. |
| S7 | Medium | **`tailwind-merge` doesn't know the custom tokens.** `shadow-1`…`7`, `rounded-pill` and `tracking-tightest` are not recognised, so a `shadow-5` override keeps the base `shadow-md`, and CSS order decides which one wins. | `packages/ui/lib/utils.ts`; `components/shell/user-card.tsx:130`; `workspace-menu.tsx:74` | Use `extendTailwindMerge` with the token scales. |
| S8 | Medium | **Shadows, radii and overlays are off the scale.** Primitives use Tailwind's default shadows (34 uses) next to token shadows (43 uses). There are about 17 radius values. Bare `rounded` is 4 px while `var(--radius)` is 12 px, and `rounded-full` and `rounded-pill` are the same value. The scrim tokens are unused, and five different scrims are used instead. | `packages/ui/components/ui/*`; `features/inbox/components/inbox-page.tsx:717`; `features/settings/components/account-tab.tsx:260` | Point primitives at the token shadows, standardise on `rounded-pill`, and add `bg-scrim`. |
| S9 | Medium | **Some CSS is dead or undefined.** `roadmap.css` has 16 unused classes, about 200 of its 530 lines. `no-scrollbar` is used but never defined, so the scrollbar shows in Command menus. `--radius-card` and `--radius-panel` are referenced but undefined. The architecture and marketing dark palettes are identical copies, and four keyframes duplicate others. | `features/roadmap/roadmap.css`; `packages/ui/components/ui/command.tsx:95` | Delete the dead rules, and define or replace the missing ones. |
| S10 | Medium | **Markdown renders with three different typographies.** Chat h1 is 18 px, the editor's is 22 px, and ui `Markdown` uses 16 px. Unlayered global rules in `custom.css` override component styles. | `custom.css`; `features/editor/content-editor.css`; `packages/ui/markdown/Markdown.tsx:200-210` | Use one prose token set, and put overrides in `@layer components`. |
| S11 | Low | **Icon sizing is mixed.** Three sizing conventions are in use, and Button's svg rule silently resizes `h-3 w-3` icons to 14 px. Fill and stroke icons are mixed in one menu, and 9 different stroke widths are used. | `features/issues/components/active-run-panel.tsx:367`; `features/chat/components/composer/composer-tools.ts:77-84` | Use `size-*` only. Keep custom icons only where lucide has no glyph. |
| S12 | Low | **There is no z-index scale.** 9 levels are in use, plus inline values, and the compose body escalates to `z-60`/`z-70`. | `features/inbox/components/inbox-compose-body.tsx:263, 268` | Add z-index tokens. |
| S13 | Low | **Raw colours bypass the tokens.** There are 83 raw palette classes in 26 files and 17 inline `rgb()` fills in the inbox SVG. Dashboard charts use primitive ramps while the `--chart-*` tokens go unused. | `features/chat/components/composer/composer-tools.ts:85-114`; `features/dashboard/dashboard.server.ts:268, 280` | Use semantic and chart tokens. |
| S14 | Low | **Fixed widths cause layout problems.** The drag overlay is 280 px against a 381 px column, so cards shrink by 100 px on pickup. Two fixed-width menus have no viewport cap. | `features/issues/components/board-view.tsx:342`; `components/shell/user-card.tsx:130`; `workspace-menu.tsx:74` | Match the column width, and cap the menus at the viewport. |

### Actions and mutations

Of the 64 `useMutation` call sites in use:

- 34 disable their control while pending.
- 56 show an error.
- All 64 refresh the cache.
- 16 update optimistically. 12 of those roll back fully on failure, 3 partially, and 1 not at all.

About 30 more actions are hand-rolled with `useState` loading flags. The worst cases are in Fix first (F5–F11, F27, F28).

| ID | Severity | Finding | Location | Fix |
| --- | --- | --- | --- | --- |
| A1 | Medium | **Team boards don't update optimistically or roll back.** `onMutate` touches only the main issue caches. A card snaps back and then jumps, and after a failure it stays in the wrong column. | `lib/issues/mutations.ts:197-236`; `features/teams/components/team-issues-panel.tsx:109-125` | Snapshot, update and roll back the team issue caches too. |
| A2 | Medium | **Enter in the invite field sends duplicate invitations.** It bypasses the disabled button, and there is no email validation. | `features/settings/components/members-tab.tsx:280-297, 404-407` | Guard on the loading state, and use a `<form>` with validation. |
| A3 | Medium | **Team dialogs have no pending state, and removing a member has no confirmation.** This covers Add member, Save, Transfer ownership and Delete team. | `features/teams/components/team-dialogs.tsx:162, 229, 308, 356`; `team-members-table.tsx:95-101` | Disable controls while pending, and confirm member removal. |
| A4 | Medium | **Disconnect, Delete integration and Trash draft act immediately.** After deleting a provider's only integration, the drawer stays open and empty. | `features/connections/components/manage-drawer-body.tsx:524-541`; `features/inbox/components/inbox-compose-dialog.tsx:280-287, 410-420` | Confirm these actions, and close the drawer when its integration is gone. |
| A5 | Medium | **The approval card on the issue page isn't disabled while resolving.** Approve and Deny can both be sent. "Edit & approve" does nothing (`onEditApprove={() => {}}`). | `features/issues/components/issue-run-surface.tsx:379-395` | Pass `pending`, and hide Edit & approve until it is implemented. |
| A6 | Medium | **Pausing or activating an automation has no feedback or error.** The automation keeps running if the request fails. | `features/automations/automation-detail-page.tsx:664-667, 705`; `features/automations/mutations.ts:23-34` | Toast on success and on error, and disable the control while pending. |
| A7 | Medium | **Brain upload and retry errors are invisible in folder and All-files views.** The review dialog closes on failure. | `features/brain/components/files-page.tsx:228-321, 494-505` | Toast the error, and keep the dialog open. |
| A8 | Medium | **"Skill attached" shows even when attaching failed**, alongside the error toast. Overlapping full-list PUTs can land out of order (Likely). | `features/agents/components/agent-skills-tab.tsx:171-192` | Toast only on success, and serialize the updates. |
| A9 | Medium | **Chat rename is optimistic with no rollback**, and the rejected promise from a failed archive is never handled. | `features/chat/use-agent-chat-sessions.ts:80-101`; `features/chat/components/session-explorer.tsx:194-222` | Roll back and toast on failure. |
| A10 | Medium | **Gmail "Load more" can land in the wrong view.** A page requested in one view is appended to another after the user switches. | `features/inbox/components/inbox-page.tsx:421-446` | Use `useInfiniteQuery` keyed by view. |
| A11 | Medium | **Escape or an outside click discards a composed email**, with no prompt and no autosave. | `features/inbox/components/inbox-compose-dialog.tsx:76-88` | Guard close when the draft is dirty. |
| A12 | Low | **Due dates are stored as local-midnight timestamps**, so they shift by a day across time zones. | `features/issues/components/pickers/due-date-picker.tsx:33-35` | Store a date-only `yyyy-MM-dd`. |
| A13 | Low | **Chat dictation stops after the first phrase**, because typing unmounts the mic. | `features/chat/components/composer/composer.tsx:238-247, 1156-1158` | Keep the mic mounted while listening. |

**Low:**

- **Success toasts before the result.** "Set as parent" and "Added as sub-issue" show success before the request finishes (`issue-detail.tsx:509-532`). Create-issue closes before its error callback can fire.
- **Infinite scroll on done issues.** It fails silently with an unhandled rejection.
- **Workspace create.** Switch errors are swallowed.
- **Chat Retry.** It resends the text but drops attachments (`chat-panel-controller.tsx:619-625`).
- **Reaction and subscriber toggles.** They revert silently on failure.
- **Skills page.**
  - Rejected promises are never handled.
  - Switching skills discards unsaved edits without a prompt.
- **Automation run history.** It never polls, so "Run now" stays queued on screen.
- **Issue delete.** It fires a GET for the deleted issue.
- **Open in chat.** A failure leaves a tab pointing at a thread that doesn't exist.
- **Resume issue.** It reports failure when only the archive step failed, and retrying starts a second run.
- **Hourly trigger.** Editing the minute overwrites the daily hour (`trigger-config.tsx:200-209`).
- **Approval continuation.** A failed approval continuation is unhandled (part of F7).

### UX and accessibility

The dashboard, Files and Teams screens handle loading and errors well. The Files error banner (`role="alert"` with Try again) is the pattern to copy. Most other screens show an empty state while loading or after an error (F20).

| ID | Severity | Finding | Location | Fix |
| --- | --- | --- | --- | --- |
| U1 | Medium | **An error on most app routes replaces the whole shell, sidebar included** (Likely). There is no `defaultErrorComponent`. The fallback's own copy says the shell stayed alive. | `routes/_authenticated.tsx`; `router.tsx`; `features/issues/components/issues-page.tsx:189` | Add an error component inside the content pane. |
| U2 | Medium | **Detail pages treat any error as "not found" or "deleted"**, and offer no Retry. | `features/issues/hooks/use-issue-detail-data.ts:55`; `issue-detail.tsx:884-895`; `features/automations/automation-detail-page.tsx:623-629`; `features/agents/components/agent-detail.tsx:49-56` | Separate a real 404 from errors, and add Retry. |
| U3 | Medium | **Several dashboard links go to the wrong place.** "You have no agents → Set one up" opens Connectors. Inbox rows with no issue navigate to `/tasks/` with an empty id. "Blocked" opens the unfiltered list. | `features/dashboard/components/dashboard-page.tsx:498-510, 640-645` | Fix the targets, and filter the Blocked link. |
| U4 | Medium | **Issue multi-select is mouse-only.** Row checkboxes are `display:none` until hover, the group select-all has no label, and "+" stays invisible on focus. | `features/issues/components/list-row.tsx:119-124`; `list-view.tsx:194-206, 233-235` | Use opacity instead of `hidden`, add `focus-visible` reveal, and add an `aria-label`. |
| U5 | Medium | **Custom overlays and tabs have no focus management.** The inbox detail drawer has no focus trap, no Escape and no scroll lock. The model picker listbox has no keyboard support. Surface tabs put `role="tab"` on a non-focusable div that wraps buttons. | `features/inbox/components/inbox-page.tsx:711-740`; `inbox-reply-input.tsx:128-184`; `packages/ui/components/shell/surface-tabs.tsx:360-398` | Use `Sheet`, `DropdownMenu` and `Tabs`, with a roving tabindex. |
| U6 | Medium | **Buttons are nested inside clickable rows.** Pressing Enter on inbox archive fires it twice (keydown plus click). | `features/inbox/components/inbox-list-item/inbox-list-item-v2.tsx:43-115`; `features/chat/components/session-explorer.tsx:91-147` | Make the action a sibling of the row, and drop the extra `onKeyDown`. |
| U7 | Medium | **The same feature has different names on different screens.** The nav says Tasks, Workflows and Connectors, while pages say Issues, Automations and Connections. The dashboard mixes Open Work, Issues and Tasks. | `features/navigation/nav-items.tsx:33-41` and page headers | Choose one term per concept. |
| U8 | Medium | **Navigation uses onClick buttons instead of links.** Sidebar items, agent and automation rows, dashboard rows and breadcrumbs can't be middle-clicked or opened in a new tab. Download buttons are unlabeled icons that call `window.open`. | `packages/ui/components/shell/app-sidebar.tsx:102-104`; `features/agents/components/agents-page.tsx:128-131`; `features/issues/components/comment-card.tsx:149-156` | Use `<Link>` and `<a href download aria-label>`. |
| U9 | Medium | **View state is not in the URL.** Agent tabs, the inbox filter, connection tabs and settings tabs can't be deep-linked. On mobile, Back from an inbox item leaves the inbox. | `features/agents/components/agent-detail.tsx:35`; `features/inbox/components/inbox-page.tsx:322, 346, 675-690`; `features/settings/components/settings-page.tsx:48` | Move them into search params, and use push for the mobile selection. |
| U10 | Medium | **The collapsed issue sidebar stays in the tab order**, so focus moves into invisible pickers. | `features/issues/components/issue-detail.tsx:858-870` | Unmount it or mark it `inert` when collapsed. |

**Low:**

- **Workspace menu** (`app-shell.tsx:308`, `workspace-menu.tsx`):
  - it opens the Profile tab
  - the header always reads "Garden"
  - two items go to the same place
- **Settings dialog:** has no `DialogTitle`.
- **Labels:** five forms have unlabeled inputs, and six icon buttons have no `aria-label`.
- **Contrast:** tertiary icon colour is about 1.9:1 on the top band.
- **Agent status:** shown by colour only.
- **Focus outline:** removed with no replacement.
- **Skeletons:** the Connections skeleton grid doesn't match the real grid.
- **Placeholder copy shipped:** "Create flow lands next", "Coming soon" and the "xlx" typo.
- **Avatar upload:** its spinner is visible only on hover.
- **Agent count:** includes archived agents.
- **Create Issue:** focus isn't restored when it closes (Likely).
- **Triggers:** shown as raw cron.
- **Dialogs:** have no max height, so footers clip on short screens (Likely).

**State handling by screen:**

| Screen | Loading | Empty | Error |
| --- | --- | --- | --- |
| Dashboard | Yes | Yes | Yes (per section, with Retry) |
| Issues list and board | Yes | Yes | No (shell replaced, U1) |
| Issue detail | Yes | n/a | Shown as "deleted" (U2) |
| Inbox | No (empty state shows) | Yes | No |
| Chat | No (blank) | Yes | No (blank) |
| Agents | Yes | Placeholder copy | No (shows "No agents") |
| Automations list | Yes | Yes | No |
| Automation detail | Yes | Yes | Shown as "not found" |
| Skills | Yes | Yes | No |
| Connections | Mismatched skeleton | Partial | Partial |
| Files and folders | No ("No folders yet") | Yes | Yes (best in app) |
| Settings: Members | No ("Members (0)") | Yes | No |
| Teams | Plain text | Yes | Yes |

### Data layer, routing and performance

The app has two competing freshness models. Realtime invalidation covers only issue and team CRUD. Polling covers the rest: inbox every 15 s on all pages, active runs every 2 s, and the inbox control plane every 1.5 s. On top of that, the global `staleTime` is `Infinity`.

| ID | Severity | Finding | Location | Fix |
| --- | --- | --- | --- | --- |
| D1 | High | **SSR and route prefetch do nothing on a hard load.** The `_authenticated` loader's data is copied into zustand from a render-phase microtask, and the shell shows a skeleton until that store is set. `prefetchActiveWorkspace` returns early on the server and when the store is empty, so 10 of 16 app routes get no prefetch. `@tanstack/react-router-ssr-query` is installed but never wired. Every hard load is a full client waterfall. | `routes/_authenticated.tsx:28-150`; `components/shell/app-shell.tsx:290-369`; `lib/navigation/prefetch.ts:23-26`; `router.tsx:40-55` | Return `user`, `workspaceId` and `workspaces` from `beforeLoad` in route context. Have loaders call `ensureQueryData`, and call `setupRouterSsrQueryIntegration`. |
| D2 | Medium | **Full lists are fetched to get a count or a title.** The shell fetches the whole inbox every 15 s on every page to compute the unread badge, even though `GET /api/inbox/unread-count` exists and is never called. Four components subscribe to the unbounded issue list to look up one title, with a per-mention detail query as fallback. The shell also warms agents, members, skills and connections on every page. | `components/shell/app-shell.tsx:53-59, 135-155`; `features/editor/extensions/mention-view.tsx:58`; `features/issues/components/issue-mention-card.tsx:44`; `components/shell/task-tabs.tsx:34` | Add an `unreadCountOptions` query, and use detail queries seeded from the list cache. |
| D3 | Medium | **Reactions are fetched under a second key.** The reactions query calls `getIssue` and keeps only `.reactions`, so opening an issue makes two requests and keeps two caches that can drift. | `lib/issues/queries.ts:278-290` | Use the detail query with `select`. |
| D4 | Medium | **There are seven ways to call the API, with three validation strategies.** About 100 of 117 call sites cast unvalidated JSON (`lib/api/transport.ts:112`). The brain module uses zod, connections use Effect Schema, skills use an Effect `HttpApiClient`, the dashboard uses `createServerFn`, and auth uses better-auth's client. 7 sites call raw `fetch`; the brain module re-implements the auth headers and 401 handling. The bundle ships two schema libraries. | `lib/api/*`; `features/brain/api.ts:164-216` | Use one transport with schema decoding shared with the server contracts. Add `requestRaw` for binary and streams. |
| D5 | Medium | **Response types are hand-written and loosely cast.** Automations wrap responses in their own envelope and turn failures into 400. `documents` types carry `ok?`/`error?` fields inside success types. `app-state` hand-maintains a 162-line `Api` type, of which 5 methods are used. Chat parts are cast through `as unknown as Record<string, unknown>` in 6 places. | `lib/api/automations.ts:17-160`; `lib/api/documents.ts:19-90`; `packages/app-state/src/platform/app-api.ts` | Share types from server contracts, and type `UIMessage` parts. |
| D6 | Medium | **Search params are read without validation.** 12 routes hand-write `typeof` checks. `/inbox` has no `validateSearch`, yet reads and writes `item`/`issue`/`focus` through `window.location`. Consumers read raw strings through the navigation adapter, which also carries desktop-only methods although there is no desktop app. | `features/inbox/components/inbox-page.tsx:319, 336`; `platform/navigation.tsx` | Use zod schemas per route with `Route.useSearch()`, and delete the adapter. |
| D7 | Medium | **Side effects run through channels that aren't effects.** `useQuery` is used to perform writes, side effects run during render, loaders write to zustand, and `useSyncExternalStore` is used as a mount effect. | `features/chat/chat-runtime-provider.tsx:107-163`; `routes/_authenticated/_app/tasks.$issueId.tsx:21-27`; `components/shell/app-shell.tsx:166` | Use `useMutation` for writes, effects or handlers for side effects, and loaders only for data. |
| D8 | Medium | **Mutations and toasts follow three patterns.** There are 32 domain hooks, 37 inline `useMutation` calls and 9 imperative API calls with loading flags. 168 direct toasts sit in components and none in mutation modules. Error-message extraction is written inline 31 times. `members-tab` calls the API with the store's workspace id but invalidates with the context id. | `features/settings/components/members-tab.tsx:284-290` and others | Use domain mutation hooks, with `MutationCache` toasts driven by `meta`. |
| D9 | Low | **Query keys and `staleTime` are inconsistent.** 15 key factories live in two places, alongside 18 inline array keys in 5 key shapes. There are two chat key factories, and 8 of 9 entries in one are unused. `staleTime` takes 11 values, with `Infinity` spelled two ways. 8 query functions wrap a call in `Result` only to rethrow. | `lib/*/queries.ts`; `features/*/queries.ts`; `lib/api/chat-threads.ts:6-20` | Use one factory per domain, shaped `[domain, wsId, entity, id, sub]`, with named `staleTime` constants. |
| D10 | Low | **Only chat is virtualized.** The issues board and list render every open issue. Inbox search re-renders the list and detail pane on every keystroke. `useActorName` returns new functions on every render. | `lib/workspace/hooks.ts:5-50`; `features/inbox/components/inbox-page.tsx:377` | Virtualize long lists, and use `useDeferredValue` with a memoized actor directory. |
| D11 | Low | **Heavy modules load eagerly.** These are `@xyflow/react` (rare graph artifacts), the 1,186-line debug drawer, and Shiki. pdfjs and emoji-mart are already lazy-loaded. | `features/chat/components/chat-artifacts.tsx:21-33`; `chat-panel-controller.tsx:31`; `components/ai-elements/code-block.tsx:28` | Load them with `React.lazy`. |
| D12 | Low | **Routing is inconsistent.** There is no default error component, and there are 4 bespoke error UIs. The default pending UI is full-screen but renders inside the shell. The auth guard lives in a loader rather than `beforeLoad`, so session and workspace checks run twice. `connectors.tsx` holds a 90-line component. | `router.tsx`; `routes/_authenticated/workspace.tsx:39-46`; `routes/_authenticated/_app/connectors.tsx` | Set default error and pending components, and guard in `beforeLoad`. |
| D13 | Low | **Forms and dialogs follow several patterns.** TanStack Form is used once, `useState` per field about 10 times, and zustand as a form store twice. `CreateIssueModal` is mounted 5 times, and no dialog is URL-driven. | `features/modals/create-workspace.tsx`; `features/inbox/components/inbox-compose-dialog.tsx` | Use TanStack Form with zod, and one dialog store with app dialogs mounted once. |
| D14 | Low | **Server state is duplicated.** The workspace is held in 4 places (loader, zustand copy, query cache, context) and the user in 3. Unused dependencies: `@tanstack/react-router-ssr-query`, `@tanstack/react-table`, `fractional-indexing` and `nuqs`, whose adapter is mounted but unused. | `packages/app-state`; `routes/__root.tsx` | Fold into D1, and remove the unused dependencies. |

## Canonical patterns

Each concern below has several competing patterns today. Adopt the one in the right column and migrate as files are touched. These complement the conventions the first audit added to `CONTRIBUTING.md`.

| Concern | Today | Use |
| --- | --- | --- |
| Server state | Loader data copied into zustand, the query cache, React context and module singletons. | Route context (from `beforeLoad`) and TanStack Query for server state. Zustand in `packages/app-state` holds UI state only. |
| Data loading | `useQuery` with `isLoading` (111 uses), suspense queries (12), effect-plus-`useState` fetches (4), and `useQuery` performing writes (2). | Route loaders call `ensureQueryData`. Components use `useSuspenseQuery` under route pending and error boundaries. |
| Query functions | Some return `[]` or zeroes on error. Some wrap calls in `Result` only to rethrow. | Throw `ApiError`. Components handle `isError`, and fallbacks live in `placeholderData`. |
| Query keys | 15 factories in two places, 18 inline arrays, and 5 key shapes. | One factory per domain in `lib/<domain>/queries.ts`, shaped `[domain, wsId, entity, id, sub]`, so realtime prefixes cover sub-resources. |
| Freshness | `staleTime: Infinity` by default, realtime for issues and teams only, and polling everywhere else. | A finite default (about 30 s) plus named constants. Realtime events invalidate workspace prefixes. Poll only while a run is active. |
| API calls | An unvalidated transport cast, zod, Effect Schema, Effect `HttpApiClient`, `createServerFn` and raw `fetch`. | One transport in `lib/api` with schema decoding shared with the server contracts, plus `requestRaw` for binary and streams. Server functions are only for SSR loaders. |
| Mutations | Domain hooks (32), inline `useMutation` (37), and imperative calls with loading flags (9). | Domain hooks in `lib/<domain>/mutations.ts`. Each owns its invalidation, and its optimistic update with rollback. |
| Toasts and errors | 168 direct toasts in components, and inline message extraction 31 times. | `MutationCache` `onSuccess`/`onError` reading `meta` messages, plus one `errorMessage()` helper. |
| Pending and destructive actions | Each dialog handles pending differently, and some deletes have no confirmation. | `<ConfirmDialog>` with built-in pending state for every destructive action. Every mutation button is disabled while pending. |
| Derived and reset state | Props copied into state through effects, side effects run during render, and effects used to reset state. | Compute during render or with `useMemo`. Reset with `key`. Keep drafts as `draft ?? serverValue`. Use effects only to sync with external systems. |
| Forms | `useState` per field, TanStack Form, and zustand form stores. | TanStack Form with zod. |
| Dialogs | Global stores, local state, and `CreateIssueModal` mounted five times. | One dialog store, with app-level dialogs mounted once in the shell. Local state only for dialogs owned by one component. |
| Navigation | TanStack hooks, a string-path adapter, onClick buttons and `window.location`. | TanStack `<Link>` and typed `navigate`. Search params validated with zod and read with `Route.useSearch()`. |
| Rich text | Tiptap, a contentEditable with `execCommand`, and a second contentEditable. | Tiptap `ContentEditor` for rich input, and a plain textarea otherwise. |
| Markdown and code | react-markdown twice, Streamdown, Shiki and lowlight. | Streamdown for streamed agent output and Tiptap for editable content, with one lazily loaded highlighter and one sanitizer. |
| Colour tokens | shadcn names and long-form names that resolve to different values. | One vocabulary, with tertiary and subtle aliases instead of opacity. |
| Typography | Arbitrary pixel sizes and 7 page-title styles. | Composite utilities, `<PageTitle>` and `<SectionLabel>`. |
| Shared UI placement | `packages/ui`, `src/components`, `features/common`, and primitives inside `features/issues`. | Presentational primitives go in `packages/ui`. App-wide, data-bound components go in `src/components`. Features import only other features' `index.ts`. |

## Enforcement

The first audit made the lint baseline strict for types and hooks. The checks below target the frontend patterns this audit found. Ratchet each from warning to error as its violations are fixed.

| Check | Catches | Notes |
| --- | --- | --- |
| `react/exhaustive-deps` from `warn` to `error` | Stale closures and unstable dependencies (F8, E9) | It is already configured, as a warning. Fix the one `eslint-disable` in `document-artifact.tsx:309` first. |
| `no-restricted-imports` patterns: `@/features/*/components/*` and `@/features/*/hooks/*` from other features | Deep cross-feature imports and cycles (C11) | Extend the existing rule in `.oxlintrc.json`, which today bans only the Neon and extra icon imports. |
| `no-restricted-syntax` on `useQuery` options whose `queryFn` calls a mutation | Queries that write (D7) | Or document the rule and review it. |
| `knip` in CI | Dead files, exports and dependencies (C12, D14) | Start in report-only mode, then fail on new dead code. |
| A Tailwind class lint (an oxlint/ESLint Tailwind plugin, or a small script) | `text-[Npx]`, raw palette classes (`text-gray-*`, `bg-emerald-*`), `hsl(var(--x))`, and the non-canonical colour names (S1, S4, S13) | Ban-list approach, so it stays fast. |
| `extendTailwindMerge` configured with the token scales | Overrides that silently don't apply (S7) | A one-time fix in `packages/ui/lib/utils.ts`. Add a unit test for `cn('shadow-md', 'shadow-5')`. |
| `jsx-a11y` rules to `error`: `click-events-have-key-events`, `no-static-element-interactions`, `label-has-associated-control`, plus a new `no-noninteractive-element-to-interactive-role` | Clickable divs, unlabeled inputs and custom roles (U4–U6) | Already configured as warnings. |
| Component tests for the Fix first items | Regressions in F1–F7 | Each fix should ship with a test that reproduces the defect, for example that the skill editor's save keeps files, that the reply box is cleared when the thread changes, and that digits typed into a contenteditable don't answer a question. |
| Lighthouse or axe smoke test on the main routes | Contrast and accessibility regressions (F18, F23, U1–U10) | Run against a preview deploy. Fail on contrast and missing-name violations. |

## Remediation roadmap

Start with the user-facing defects. Each is a small change with a test. Then fix the data layer, because its error, key and freshness problems cause several UI symptoms. The component and styling work can run in parallel after that. Every phase can be split into small PRs, one concern per commit.

1. **Phase 0: Fix first (days).** F1–F29, in table order.
   - F1–F7 lose user data or hang the UI. Each needs a regression test.
   - F11 and F10 come with the shared `<ConfirmDialog>` (C3), which also fixes every other destructive dialog.
2. **Phase 1: Data layer (1–2 weeks).** This removes the root causes of F14–F16 and E11.
   - Query functions throw (F14), and keys are nested under the issue detail key (F15).
   - Use a finite default `staleTime` with named constants (D9).
   - Unread-count query (D2), and reactions read from the detail query (D3).
   - Route context from `beforeLoad`, with SSR query integration (D1, D14).
   - Domain mutation hooks and `MutationCache` toasts (C4, D8).
3. **Phase 2: Shared components and design system (2–3 weeks, in parallel with Phase 1).**
   - Add `ConfirmDialog`, `CopyButton`, `ImageLightbox`, `FilePreviewDialog`, `SearchInput`, `PageHeader`, `SectionLabel`, `StatusBadge` and `SegmentedControl` (C3, C9, C16, C18, S5).
   - Add the `DialogContent` size variant and the Button, Badge and Input variants (S3, S6).
   - Pick one colour vocabulary and codemod to it, add status tokens, and configure `extendTailwindMerge` (S1, F23, S7).
4. **Phase 3: Break up the god components (2–4 weeks).** Do these once the shared pieces and domain hooks exist, in this order:
   - `skills-page` (C2, F17)
   - `files-page` (C1)
   - `inbox-page` and the inbox reply box (C15, C5)
   - `chat-panel-controller` (C6, F29)
   - the automation forms (C7)
   - `issue-detail` (C17)
   - `comment-card` (C8)
5. **Phase 4: UX, accessibility and enforcement (ongoing).**
   - Loading and error states on every screen (F20, U1, U2).
   - Small-screen shell (F21).
   - Links instead of onClick navigation (U8), and view state in the URL (U9).
   - One name per feature (U7).
   - Delete dead code (C12).
   - Ratchet the Enforcement checks to errors.

## Appendix: metrics, coverage and method

**The 15 largest components (lines).** Five exceed 1,000 lines.

| File | Lines |
| --- | ---: |
| `skills-page.tsx` | 1,514 |
| `automations-page.tsx` | 1,200 |
| `environment-debug-drawer.tsx` | 1,186 |
| `composer.tsx` | 1,185 |
| `files-page.tsx` | 1,061 |
| `chat-panel-controller.tsx` | 959 |
| `issue-detail.tsx` | 902 |
| `dashboard-page.tsx` | 882 |
| `automation-detail-page.tsx` | 847 |
| `chat-document-panel.tsx` | 842 |
| `inbox-page.tsx` | 766 |
| `inbox-compose-dialog.tsx` | 726 |
| `comment-card.tsx` | 693 |
| `bubble-menu.tsx` | 682 |
| `connections-page.tsx` | 584 |

The five files over 1,000 lines are the first split candidates in Phase 3, along with `issue-detail.tsx`, which is a single 902-line component.

| Metric | Value |
| --- | --- |
| Files audited | 481 (about 75,600 lines) |
| Components over 500 lines | 24 |
| `useEffect` / `useLayoutEffect` calls | 63 in 36 files (all reviewed) |
| `useMutation` sites in use | 64. Of these, 34 disable while pending, 56 show errors and 16 are optimistic. |
| Direct toast calls | 168 in 43 files |
| Arbitrary Tailwind values | 634, of which 275 are font sizes across 22 values |
| Raw palette colour classes | 83 in 26 files |
| Raw `<button>` outside `packages/ui` | 132 |
| Hand-built confirm dialogs | 12 |
| Cross-feature imports | 113, of which 93 reach into internals |
| Distinct `staleTime` values | 11 |
| Ways of calling the API | 7 |
| Dead code | About 1,100 lines, plus 4 unused dependencies |

**Checked and found sound:**

- **Unsafe HTML:** every `dangerouslySetInnerHTML` use is a constant or escaped. `ReadonlyContent` sanitizes its HTML and URLs.
- **Redirects:** sanitized on every auth route.
- **Parsing:** `JSON.parse` calls are wrapped.
- **Cleanup:** observers, intervals and listeners are cleaned up, apart from the leaks listed above.
- **Links:** `target="_blank"` links carry `rel`.
- **Query keys:** workspace-scoped keys include the workspace id.
- **Theme tokens:** light and dark define the same 142 semantic tokens.
- **Class strings:** no class string contains conflicting utilities.
- **Lazy loading:** pdfjs and emoji-mart are lazy-loaded.
- **Routes:** most route files are thin.

**Method:**

- **Scope:** the audit was read-only, at upstream `dev` commit `edb7510`.
- **Seven parallel passes:**
  - effects and state
  - components and duplication
  - styling and design system
  - actions and mutations
  - UX, accessibility and layout
  - correctness
  - data layer, routing and performance
- **Checking:** every finding cites code that was read. These were re-checked against the source by a second reader:
  - F1, F2, F7, F11, F14, F15, F17, F18, F19, F23 and F24
  - S3, plus samples of C4 and C12
- **Merging:** findings reported by several passes were merged under one ID.
- **Runtime:** nothing was run in a browser. Findings whose impact depends on timing or runtime behaviour are marked *Likely*.
- **Instruction files:** the repository's agent instruction files were not used.
