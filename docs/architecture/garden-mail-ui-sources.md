# Garden Mail UI pattern map

Implementation-grade source archaeology for replacing Garden's current Inbox surface with a unified notification + mail inbox. This document specifies direct adaptations from Zero and Cloudflare Agentic Inbox; it does not introduce a third visual system.

## Pinned sources

- Zero: https://github.com/mail-0/zero, commit
  `64c5480c341750578da0746f2db9ad84da686334`. It was inspected from the
  session clone `/tmp/zero-ui.SJUDlu`.
- Cloudflare Agentic Inbox: https://github.com/cloudflare/agentic-inbox,
  commit `48039bb6785af34e592c2966f87cde2b255c4c80`. It was inspected from the
  session clone `/tmp/agentic-inbox.mHy5hP`.
- Garden comparison: `/home/kixey/agency/garden` at the working-tree state inspected on 2026-08-10.
- OpenShip's bundled Zero fork at
  https://github.com/openshiporg/openship (commit
  `73894618`) was checked only for drift. It mostly removes Zero's AI/upsell UI
  and changes the data layer; the pinned upstream Zero paths below are the
  canonical visual references.

## Non-negotiable adaptation rule

Copy the interaction composition and geometry from the named sources. Do not port their router, query, local-state, error-handling, or mail-domain implementations. Garden has its own dock, tokens, TanStack routing/query conventions, Effect workflows, approval model, and a ban on `useEffect` and `try/catch`.

The direct combination is:

- Zero supplies the dense mail list, search/filter header, thread reading flow, inline reply composer, attachment controls, and full composer detail.
- Cloudflare supplies the simpler dock-compatible split shell, accessible list-row mechanics, folder navigation, explicit loading/empty/error treatments, draft treatment, and sandboxed HTML-message frame.
- Garden keeps its outer rail, FlexLayout dock chrome, existing notification details/control plane, and semantic visual tokens.

## Current Garden surface and constraints

### Existing Inbox behavior to preserve

- `apps/web/src/features/inbox/components/inbox-page.tsx:49-133`: header, unread count, Unreads switch, bulk menu, search.
- `apps/web/src/features/inbox/components/inbox-page.tsx:196-257`: notification detail header, preview, approval/control plane, issue CTA.
- `apps/web/src/features/inbox/components/inbox-page.tsx:263-447`: URL-backed selection, filtering, click-to-read, archive operations.
- `apps/web/src/features/inbox/components/inbox-page.tsx:451-493`: mobile list/detail swap and desktop 320px list/detail split.
- `apps/web/src/features/inbox/components/inbox-list-item.tsx:38-94`: notification row and hover archive action.
- `apps/web/src/features/inbox/components/inbox-item-preview.tsx`: notification-specific content cards.
- `apps/web/src/features/inbox/components/inbox-control-plane.tsx`: notification approvals, questions, reviews, and actions. Do not replace this with mail UI.

### Dock constraints

- Inbox is a singleton FlexLayout panel: `apps/web/src/components/shell/workspace-dock/types.ts:77-95`.
- Any dock pane can be split, expanded, pinned, or shrunk: `apps/web/src/components/shell/workspace-dock/chrome.tsx:50-110`.
- Dock minimum tabset width is 240px: `apps/web/src/components/shell/workspace-dock/model.ts:86-103`.
- Inbox currently does **not** use Garden's context rail: `apps/web/src/components/shell/workspace-dock/types.ts:130-145`.
- Current desktop Inbox hardcodes a 320px list even though its containing dock pane can be 240px: `apps/web/src/features/inbox/components/inbox-page.tsx:477-492`.

Consequences for adaptation:

1. Do not copy Zero's full-height app shell or nest Zero's resizable panels inside FlexLayout. Garden's dock is already the resizable container.
2. Do not decide list/detail mode from viewport width. Both references use `md` viewport breakpoints because they own the whole page; a Garden pane can be 240px inside a desktop viewport. Reproduce the same states based on the Inbox pane's available width.
3. At compact pane width, show one state at a time: list, message detail, or compose. This is exactly the reference mobile behavior, applied to a dock container.
4. At sufficient pane width, use Cloudflare's fixed list + flexible detail composition. Zero's percentage `ResizablePanel` sizing assumes an entire viewport and is not appropriate inside a dock.

## Exact source map

### 1. Mailbox navigation

#### Zero

- `apps/mail/config/navigation.ts:45-136`: canonical folders are Inbox, Drafts, Sent, Archive, Snoozed, Spam, Trash, grouped into Core and Management with keyboard shortcuts.
- `apps/mail/components/ui/app-sidebar.tsx:92-127`: collapsible mail sidebar, user identity, compose button, navigation content.
- `apps/mail/components/ui/app-sidebar.tsx:176-220`: 32px full-width blue Compose button; full-screen compose dialog.
- `apps/mail/components/ui/nav-main.tsx`: actual active navigation rows, badges, shortcuts, collapsed labels.
- `apps/mail/lib/constants.tsx:7-9`: Zero sidebar is `14rem`, mobile `14rem`, icon mode `3rem`.

#### Cloudflare

- `/tmp/agentic-inbox.mHy5hP/app/components/Sidebar.tsx:17-38`: exact system folder set and icons: Inbox, Sent, Drafts, Archive, Trash.
- `/tmp/agentic-inbox.mHy5hP/app/components/Sidebar.tsx:48-72`: active row composition: icon, truncated label, unread badge; active `bg-kumo-fill`, inactive hover `bg-kumo-tint`.
- `/tmp/agentic-inbox.mHy5hP/app/components/Sidebar.tsx:124-158`: mailbox display name/address followed by a full-width Compose button.
- `/tmp/agentic-inbox.mHy5hP/app/components/Sidebar.tsx:160-220`: system folders, custom folder section, and create-folder action.
- `/tmp/agentic-inbox.mHy5hP/app/routes/mailbox.tsx:42-66`: 256px sidebar becomes a slide-in overlay with dimmed backdrop in compact mode.

#### Direct Garden adaptation

Use Cloudflare's mailbox-identity + Compose + folder-row composition in Garden's context rail, not a second permanent sidebar inside the Inbox pane. Make Inbox eligible for the existing context rail through `workspace-dock/types.ts`; populate that rail using Garden primitives while preserving Cloudflare's exact information order and row density. Use Zero's broader folder taxonomy only where the backend supports the folder.

Do not copy Zero's account upsell card (`app-sidebar.tsx:129-165`), Zero user/account controls, Cloudflare's “Back to Mailboxes” app navigation, or either app's full-page shell.

### 2. Unified Inbox toggle and filters

The user requires the current Inbox to remain, selectable alongside mail rather than being deleted.

#### Zero

- `apps/mail/components/ui/tabs.tsx:8-36`: compact 28px inset tabs: muted rounded container, 2px horizontal trigger padding, active background/text/shadow.
- `apps/mail/components/ui/toggle-group.tsx:13-55` and `toggle.tsx:7-42`: compact single/multi-select button grouping with pressed state.
- `apps/mail/components/mail/mail.tsx:436-485`: 40px search/filter trigger shows active filter descriptions, a Clear action, and keyboard shortcut.
- `apps/mail/components/mail/mail.tsx:487-489` plus `CategoryDropdown` later in the same file: optional category filter beside search; checkmarks show selected values.
- `apps/mail/components/mail/mail.tsx:491-512`: selected-item mode replaces the search controls with count and explicit Esc exit.

#### Cloudflare

- `/tmp/agentic-inbox.mHy5hP/app/components/Header.tsx:62-124`: search collapses on compact screens; Enter executes and Escape clears/collapses.
- `/tmp/agentic-inbox.mHy5hP/app/routes/search-results.tsx:17-36`: search-term highlighting.
- `/tmp/agentic-inbox.mHy5hP/app/routes/search-results.tsx:78-107`: search header, count, empty result help, and result rows.

#### Direct Garden adaptation

At the top of the existing Inbox list, use Zero's compact `TabsList` pattern with the product's three existing data scopes: **All**, **Mail**, **Notifications**. This is the requested toggle, not a new navigation surface. Keep Garden's existing Unreads control as a secondary filter. Use Zero's search/filter trigger and selected-count replacement behavior rather than adding new chips or cards.

When space is compact, keep the same controls but collapse the text search into Cloudflare's icon-to-expanded-search behavior. Search and scope state should remain visible and reversible; selected state temporarily replaces them exactly as Zero does.

### 3. Conversation/mail list rows

#### Zero

- `apps/mail/components/mail/mail-list.tsx:226-250`: rounded list row with selected/bulk-selected/keyboard-focused background and ring.
- `apps/mail/components/mail/mail-list.tsx:252-342`: hover action capsule containing Star, Important, Archive, and Trash.
- `apps/mail/components/mail/mail-list.tsx:344-399`: selected avatar becomes a blue check; otherwise group avatar or BIMI avatar.
- `apps/mail/components/mail/mail-list.tsx:400-507`: sender, unread dot and weight, thread count, draft marker, labels, date, subject/snippet.
- `apps/mail/components/mail/mail-list.tsx:706-888`: keyboard focus, click-to-read, modifier-based bulk/range selection.
- `apps/mail/components/mail/mail-list.tsx:949-1017`: loading, filtered empty state, 100px virtualized rows, infinite-load spinner.

#### Cloudflare

- `/tmp/agentic-inbox.mHy5hP/app/routes/email-list.tsx:234-255`: thread-aware unread calculation and click-to-read.
- `/tmp/agentic-inbox.mHy5hP/app/routes/email-list.tsx:318-405`: accessible row is focusable, activates on Enter/Space, and contains unread dot, star, participants, thread count, Draft, Needs reply, date, subject, snippet.
- `/tmp/agentic-inbox.mHy5hP/app/routes/email-list.tsx:406-438`: hover actions for mark read/unread and delete.
- `/tmp/agentic-inbox.mHy5hP/app/routes/search-results.tsx:89-103`: compact three-line variant with folder badge for cross-folder search.

#### Direct Garden adaptation

Build mail rows from Zero's visual structure and density. Add Cloudflare's keyboard role/tabIndex/Enter/Space behavior and its explicit `Draft`/`Needs reply` statuses. Preserve Garden notification rows as their own renderer (`InboxListItem`), but place both renderers in the same list and under the same selected/hover background rules.

Exact mail-row order:

1. selection/avatar affordance;
2. participant + unread indicator + thread count/draft/needs-reply statuses + date;
3. subject;
4. snippet/labels;
5. Zero hover action capsule.

Do not copy Zero's `memo(..., () => true)` at `mail-list.tsx:1019`; it can freeze row updates. Do not copy modifier selection logs, Jotai atoms, Virtua integration, or backend-aware optimistic hooks directly. Reproduce the behavior through Garden's state/query layer.

### 4. Selection, read, archive, move, and delete

#### Zero

- `apps/mail/components/mail/mail.tsx:491-512`: bulk-selected count and Esc exit header.
- `apps/mail/components/mail/mail-list.tsx:767-846`: single, mass, range, and select-below behaviors.
- `apps/mail/components/mail/select-all-checkbox.tsx`: all/none/partial list selection and action integration.
- `apps/mail/components/mail/optimistic-thread-state.tsx` and `apps/mail/hooks/use-optimistic-actions.ts`: interaction intent reference for immediate UI state.
- `apps/mail/components/mail/thread-display.tsx:795-930`: detail actions: reply-all, star, archive, trash, restore/move to inbox, print, spam, unsubscribe, important.

#### Cloudflare

- `/tmp/agentic-inbox.mHy5hP/app/components/email-panel/EmailPanelToolbar.tsx:62-156`: compact detail toolbar with responsive Back/Close, reply/reply-all/forward, star, read/unread, move, source, delete.
- `/tmp/agentic-inbox.mHy5hP/app/components/email-panel/EmailPanelToolbar.tsx:158-212`: minimal move-to-folder popup.

#### Direct Garden adaptation

Use Zero's row hover capsule and selected-count header. Use Cloudflare's detail-toolbar ordering and responsive Back versus Close behavior. Keep destructive confirmation, but use Garden dialog primitives rather than `window.confirm` from Cloudflare. All mutations must update the row immediately and reconcile through Garden's query layer.

### 5. Split view and responsive states

#### Zero

- `apps/mail/components/mail/mail.tsx:415-538`: list pane with search header; list is fixed at 35% of a full-page resizable group.
- `apps/mail/components/mail/mail.tsx:542-556`: thread fills the remaining desktop area.
- `apps/mail/components/mail/mail.tsx:558-567`: selected thread becomes a full-screen overlay on mobile.
- `apps/mail/components/mail/thread-display.tsx:723-770`: no-selection empty state and thread-detail skeleton.

#### Cloudflare

- `/tmp/agentic-inbox.mHy5hP/app/components/MailboxSplitView.tsx:20-48`: when no panel is open, list fills width; when selected/compose is open, list is hidden compactly or fixed at 380px on desktop and detail fills the rest.
- `/tmp/agentic-inbox.mHy5hP/app/components/MailboxSplitView.tsx:35-45`: compose and selected email share the same detail slot; replying can stack composer above the referenced email.
- `/tmp/agentic-inbox.mHy5hP/app/components/email-panel/EmailPanelToolbar.tsx:63-74`: Back appears only compactly; Close appears only on desktop.

#### Direct Garden adaptation

Use Cloudflare's split algorithm inside the Garden Inbox panel:

- no selection: list is full width;
- selection at wide pane width: fixed 380px list with flexible detail;
- selection at compact pane width: detail replaces list and shows Back;
- compose at wide width: composer occupies detail;
- compose at compact width: composer replaces list;
- reply: inline within the thread, following Zero rather than stacking a second full composer above the message.

Use pane/container width for these states. Preserve the source threshold semantics (`md`/768px) as a container threshold instead of a viewport threshold. Do not add a nested resize handle.

### 6. Thread detail and individual messages

#### Zero

- `apps/mail/components/mail/thread-display.tsx:723-770`: empty and loading states.
- `apps/mail/components/mail/thread-display.tsx:773-932`: sticky detail toolbar.
- `apps/mail/components/mail/thread-display.tsx:933-1000`: message list and sticky inline reply at bottom.
- `apps/mail/components/mail/thread-display.tsx:1018-1053`: every message renders separately; reply composer can be inserted immediately after any message.
- `apps/mail/components/mail/mail-display.tsx:660-720`: newest message expands by default; older messages collapse unless actively replied to.
- `apps/mail/components/mail/mail-display.tsx:1230-1645`: subject/label metadata, sender avatar and address details, recipient/security/date metadata, collapse behavior, body.
- `apps/mail/components/mail/mail-display.tsx:1645-1736`: attachments followed by Reply, Reply All, Forward.

#### Cloudflare

- `/tmp/agentic-inbox.mHy5hP/app/components/EmailPanel.tsx:53-86`: thread assembly, newest-first order, newest message expanded initially, draft identification.
- `/tmp/agentic-inbox.mHy5hP/app/components/EmailPanel.tsx:144-218`: toolbar + subject header + thread/single-message branching.
- `/tmp/agentic-inbox.mHy5hP/app/components/email-panel/ThreadMessage.tsx:72-105`: compact collapsed message row.
- `/tmp/agentic-inbox.mHy5hP/app/components/email-panel/ThreadMessage.tsx:108-219`: expanded message, draft styling/actions, body, attachments.
- `/tmp/agentic-inbox.mHy5hP/app/components/email-panel/SingleMessageView.tsx:21-61`: one-message detail hierarchy.
- `/tmp/agentic-inbox.mHy5hP/app/components/EmailAttachmentList.tsx:31-81`: compact attachment chips and image preview behavior.

#### Direct Garden adaptation

Use Zero's thread structure and inline reply placement. Use Cloudflare's simpler collapsed-row markup and visible draft-left-border treatment. Use Zero's richer recipient/security detail popover only after the underlying data exists. Keep reply/reply-all/forward buttons at the end of an expanded message as Zero does.

### 7. Safe email-body rendering

#### Preferred source

- `/tmp/agentic-inbox.mHy5hP/app/components/EmailIframe.tsx:14-29`: documented security model.
- `/tmp/agentic-inbox.mHy5hP/app/components/EmailIframe.tsx:62-139`: DOMPurify, strict CSP, fixed-position neutralization, and `srcdoc` construction.
- `/tmp/agentic-inbox.mHy5hP/app/components/EmailIframe.tsx:142-149`: opaque-origin iframe sandbox without `allow-same-origin`.

Zero instead injects server-processed HTML into an open ShadowRoot at `apps/mail/components/mail/mail-content.tsx:89-115`. A ShadowRoot isolates styles, not trust. Do not copy that as Garden's security boundary.

Directly adapt Cloudflare's iframe pattern, retaining sanitization + opaque-origin sandbox + CSP together. Rework lifecycle code to comply with Garden's `useEffect` ban; do not weaken the sandbox merely to simplify sizing.

### 8. Composer and drafts

#### Zero full composer

- `apps/mail/components/create/create-email.tsx:235-299`: full-screen compose host with 750px centered composer, Escape affordance, draft-loading state.
- `apps/mail/components/create/email-composer.tsx:614-689`: 750px/500px composer shell; recipient autosuggest and progressive Cc/Bcc.
- `apps/mail/components/create/email-composer.tsx:691-751`: subject and From alias selector.
- `apps/mail/components/create/email-composer.tsx:753-767`: rich body region.
- `apps/mail/components/create/email-composer.tsx:770-950`: Send, schedule, attachment picker/list, templates, formatting toggle.
- `apps/mail/components/create/email-composer.tsx:1007-1057`: unsaved-change and missing-attachment confirmations.
- `apps/mail/components/create/toolbar.tsx:23-240`: formatting toolbar.
- `apps/mail/components/mail/reply-composer.tsx:259-281`: compact composer reused inline inside a thread.

#### Cloudflare dock-compatible composer

- `/tmp/agentic-inbox.mHy5hP/app/components/ComposePanel.tsx:40-61`: fixed header and close.
- `/tmp/agentic-inbox.mHy5hP/app/components/ComposePanel.tsx:62-143`: inline validation banner, To/Cc/Bcc/Subject, bordered rich editor.
- `/tmp/agentic-inbox.mHy5hP/app/components/ComposePanel.tsx:146-180`: fixed footer with Discard, Save as Draft, Send and explicit pending labels.
- `/tmp/agentic-inbox.mHy5hP/app/components/RichTextEditor.tsx:90-238`: compact formatting-toolbar composition.
- `/tmp/agentic-inbox.mHy5hP/app/components/email-panel/ThreadMessage.tsx:170-207`: draft-in-thread actions: Send, Edit, Discard.

#### Direct Garden adaptation

Use Cloudflare's panel shell because it fits the dock. Fill it with Zero's mail-specific capabilities: recipient autosuggest, progressive Cc/Bcc, From alias, attachment list, formatting toggle, missing-attachment warning, and draft preservation. Use Zero's compact reuse of the same composer for inline replies. Use Cloudflare's explicit error Banner and pending button labels.

Do not copy Zero's Generate/AI subject buttons, Zero's schedule-send UI until scheduling exists, Cloudflare's manual Save as Draft if Garden autosaves, or either source's form/mutation implementation. Agent drafts should enter this same composer with visible authorship/approval status supplied by Garden, not a separate visual editor.

### 9. Loading, empty, error, and refresh states

#### Zero

- `apps/mail/components/mail/mail-list.tsx:959-977`: centered list spinner and filter-aware empty state.
- `apps/mail/components/mail/mail-list.tsx:925-929,1007-1014`: incremental and background-refresh spinners.
- `apps/mail/components/mail/mail-skeleton.tsx:7-134`: detailed message skeleton.
- `apps/mail/components/mail/thread-display.tsx:738-770`: no-selection prompt and message-detail skeleton.
- `apps/mail/components/create/create-email.tsx:249-255`: draft-loading placeholder.

#### Cloudflare

- `/tmp/agentic-inbox.mHy5hP/app/routes/email-list.tsx:47-81`: folder-specific empty-state copy/icons/action.
- `/tmp/agentic-inbox.mHy5hP/app/routes/email-list.tsx:83-102`: eight-row list skeleton matching final row geometry.
- `/tmp/agentic-inbox.mHy5hP/app/routes/email-list.tsx:284-308`: header count and refresh button with spinning state.
- `/tmp/agentic-inbox.mHy5hP/app/components/EmailPanel.tsx:22-29`: message-detail skeleton.
- `/tmp/agentic-inbox.mHy5hP/app/components/ComposePanel.tsx:64`: in-context error Banner.
- `/tmp/agentic-inbox.mHy5hP/app/routes/search-results.tsx:78-88`: search loader and informative no-results state.

#### Direct Garden adaptation

Use Cloudflare skeletons because their dimensions match the target Cloudflare/Zero hybrid rows and detail. Use Zero's no-selection message and incremental-load behavior. Use folder/scope-specific empty states, but render the existing Garden notification empty copy when Notifications is selected. Use the Cloudflare Banner composition for recoverable list/detail/compose errors. Neither reference has a strong list-query error boundary; do not copy that omission.

### 10. Visual tokens and geometry

#### Zero token source

- `apps/mail/app/globals.css:21-80`: light semantic colors, sidebar tokens, radius `0.5rem`, and explicit panel/icon/blue constants.
- `apps/mail/app/globals.css:82-117`: dark semantic colors.
- `apps/mail/app/globals.css:119-181`: Tailwind token exposure.
- Key geometry: 28px tabs; 32px Compose; 40px search; 24px hover-action buttons; 32px avatars; 7-8px row radius; 14px main row text; 12px metadata; 750px max composer; 380px list in Cloudflare split.

#### Cloudflare token source

- `/tmp/agentic-inbox.mHy5hP/app/index.css:1-3`: Kumo is imported as a complete Tailwind style layer.
- Components consistently use: `kumo-base` (main surface), `kumo-recessed` (secondary surface), `kumo-elevated` (popup), `kumo-line` (dividers), `kumo-fill` (selected/subtle fill), `kumo-tint`/`kumo-overlay` (hover), `kumo-default`/`strong`/`subtle`/`inverse` (text), `kumo-brand`, `warning`, `destructive`, and `link` states.

#### Garden translation

Do not paste Zero hex values or Kumo globals over Garden. Garden already exposes the same semantic roles in `packages/ui/styles/tokens.css:138-173` and `:210-242`. Preserve Garden's atmosphere while copying source hierarchy and dimensions:

| Source role | Garden role |
| --- | --- |
| `kumo-base`, Zero `background/panel` | `background`/current dock surface |
| `kumo-recessed`, Zero sidebar surface | `sidebar` or `muted` |
| `kumo-fill`, Zero selected `primary/5` | `sidebar-accent`/`accent` |
| `kumo-tint`, `kumo-overlay`, Zero hover offset | `accent` with existing hover opacity |
| `kumo-line`, Zero `border` | `border` |
| `kumo-default`/Zero `foreground` | `foreground` |
| `kumo-subtle`/Zero `muted-foreground` | `muted-foreground` |
| `kumo-brand`, Zero `#006FFE` | Garden `brand` |
| `kumo-warning` | Garden warning/amber semantic state |
| `kumo-destructive` | Garden destructive semantic state |

This is token translation, not a redesign: structure, spacing, sizing, visibility, and interaction states stay source-faithful.

## Direct adaptation matrix

| Garden implementation unit | Primary source to copy | Secondary source | Required adaptation |
| --- | --- | --- | --- |
| `InboxPage` shell | Cloudflare `MailboxSplitView.tsx:20-48` | Zero `mail.tsx:415-567` | Container-width states; no nested resizer; retain notification branch |
| Inbox scope toggle | Zero `ui/tabs.tsx:8-36` | existing Garden Inbox header | All/Mail/Notifications in same compact inset tabs |
| Search/filter header | Zero `mail.tsx:436-512` | Cloudflare `Header.tsx:62-124` | active filter count/Clear; compact icon expansion |
| Mailbox/folder rail | Cloudflare `Sidebar.tsx:48-220` | Zero `navigation.ts:45-136` | mount in Garden context rail; use supported folders only |
| Notification row | existing Garden `inbox-list-item.tsx` | Zero row selected/hover states | keep content, normalize selected/hover geometry |
| Mail conversation row | Zero `mail-list.tsx:226-507` | Cloudflare `email-list.tsx:318-438` | add keyboard semantics and Draft/Needs reply status |
| Bulk mode | Zero `mail.tsx:491-512`, `mail-list.tsx:767-846` | Zero `select-all-checkbox.tsx` | replace header during selection; Garden mutation/query wiring |
| Detail toolbar | Cloudflare `EmailPanelToolbar.tsx:62-156` | Zero `thread-display.tsx:795-930` | compact Back/desktop Close plus supported mail actions |
| Thread message | Zero `mail-display.tsx:660-1736` | Cloudflare `ThreadMessage.tsx:72-219` | Zero information hierarchy; Cloudflare collapsed/draft markup |
| Email HTML body | Cloudflare `EmailIframe.tsx:14-149` | none | retain DOMPurify + opaque sandbox + CSP; Garden lifecycle style |
| Attachments | Cloudflare `EmailAttachmentList.tsx:31-81` | Zero composer attachment popover | chips/previews in thread; richer removable list in composer |
| Full compose | Cloudflare `ComposePanel.tsx:40-180` | Zero `email-composer.tsx:614-1057` | dock panel shell with Zero mail fields/capabilities |
| Inline reply | Zero `thread-display.tsx:990-1050`, `reply-composer.tsx:259-281` | Cloudflare form states | same composer, compact shell, explicit pending/error status |
| Draft in thread | Cloudflare `ThreadMessage.tsx:72-219` | Zero draft markers | warning edge + Draft badge + Send/Edit/Discard |
| List loading/empty | Cloudflare `email-list.tsx:47-140` | Zero `mail-list.tsx:949-1017` | skeleton first load, subtle spinner background refresh |
| Detail loading/empty | Zero `thread-display.tsx:738-770` | Cloudflare `EmailPanel.tsx:22-29` | no-selection prompt + geometry-matched skeleton |
| Notification detail | existing Garden `inbox-page.tsx:196-257` | none | preserve verbatim behavior; only shared surrounding toolbar/layout changes |

## Suggested Garden file boundaries

These are implementation destinations, not new visual concepts:

- Keep `features/inbox/components/inbox-page.tsx` as the unified shell/controller.
- Keep `inbox-list-item.tsx`, `inbox-item-preview.tsx`, and `inbox-control-plane.tsx` for notification rendering.
- Add `inbox-scope-tabs.tsx` as the direct Zero Tabs adaptation.
- Add `mailbox-navigation.tsx` as the direct Cloudflare Sidebar navigation adaptation.
- Add `mail-conversation-list-item.tsx` as the Zero row + Cloudflare accessibility adaptation.
- Add `mail-conversation-detail.tsx`, `mail-message.tsx`, and `mail-detail-toolbar.tsx` from the mapped thread sources.
- Add `mail-composer.tsx` and `mail-rich-text-editor.tsx` from Cloudflare's shell plus Zero's controls.
- Add `mail-html-frame.tsx` from Cloudflare `EmailIframe` security composition.
- Add `mail-list-states.tsx` for copied skeleton/empty/error compositions.

Avoid a single copied 1,000-line `mail-list.tsx` or 1,700-line `mail-display.tsx`; source behavior can be copied without reproducing source file-size problems.

## Licensing and dependency constraints

### Zero

- `/tmp/zero-ui.SJUDlu/LICENSE` is MIT, copyright 2025 Zero Email.
- Include the copyright and permission notice in copies or substantial portions. If code is copied substantially, add a repository third-party notice and retain the MIT text.
- MIT does not grant rights to Zero trademarks or brand assets. Do not copy the Zero name/logo, pricing/upsell copy, product screenshots, or marketing assets.

### Cloudflare Agentic Inbox

- `/tmp/agentic-inbox.mHy5hP/LICENSE` is Apache-2.0.
- Source files carry `Copyright (c) 2026 Cloudflare, Inc.` and Apache-2.0 headers. Retain those headers for copied files/substantial blocks, mark modified files, and include the license in third-party notices.
- No `NOTICE` file exists in the inspected clone. If a newer source/package supplies one, it must be included.
- Apache-2.0 does not grant Cloudflare trademark rights. Do not copy Cloudflare logos or present Garden as a Cloudflare product.

### Package constraints

- Garden does not currently depend on `@cloudflare/kumo`, `@phosphor-icons/react`, TipTap, DOMPurify, Jotai, Virtua, or `react-hotkeys-hook`.
- Agentic Inbox's Kumo styles are loaded globally with `@import "@cloudflare/kumo/styles/tailwind"`; adding that directly can collide with Garden's Tailwind and semantic-token layer. Kumo package licensing was not present in the cloned repository and must be verified from the package itself before direct dependency use.
- Garden already has equivalent Button, Tabs, Toggle, Checkbox, Skeleton, ScrollArea, Dialog, DropdownMenu, Tooltip, Sidebar, and related primitives under `packages/ui/components/ui`. Use those to reproduce the exact source composition unless Kumo is deliberately isolated and approved.
- Zero uses TipTap 2 while Agentic Inbox uses TipTap 3. Do not install both. Select one editor version only after checking Garden's dependency graph, then reproduce the mapped toolbar.
- Zero uses React Router + `nuqs`, Jotai, Virtua, and `useEffect`; Agentic Inbox uses React Router + Zustand and `useEffect`. None of that state/routing code should cross into Garden unchanged.
- Both repos contain `try/catch`; Garden forbids it. Async operations must be expressed through Effect and Garden's `better-result` conventions at boundaries.

## What must not be copied

- Zero/Cloudflare full-page app shells, duplicate permanent sidebars, or viewport-height assumptions.
- Nested resizable panels inside Garden's FlexLayout pane.
- Zero AI sidebar, Generate buttons, upgrade card, pricing controls, or Zero-specific categories.
- Cloudflare AgentSidebar/MCP panel as a second Garden agent experience; Garden already owns agents and collaboration.
- Zero or Cloudflare auth/account/mailbox-selection UI.
- Zero ShadowRoot email rendering as a security boundary.
- `window.confirm`, `window.prompt`, router hooks, query hooks, local stores, analytics, billing, or API calls from either source.
- Raw Kumo token CSS, Zero hard-coded brand colors, fonts, logos, icons, screenshots, or trademarks.
- Nonfunctional UI such as schedule-send, snooze, custom folders, labels, or AI actions before the matching domain/runtime operation exists.
- Source bugs and debt: permanent `memo(..., () => true)`, debug logging, `useEffect`, `try/catch`, and oversized components.

## Acceptance checklist for UI fidelity

- Inbox still exposes existing notifications and their control-plane actions.
- Scope switches through the copied compact Zero tabs; no bespoke cards or dashboard view.
- Folder navigation follows Cloudflare's identity/Compose/system-folder stack.
- Mail list row matches Zero's avatar, hierarchy, unread treatment, statuses, labels, timestamp, and hover action capsule.
- List row is keyboard-operable using Cloudflare's Enter/Space behavior.
- Detail toolbar ordering and compact Back/desktop Close match Cloudflare.
- Thread messages collapse/expand and inline replies appear where Zero places them.
- Drafts are visibly distinct and expose Send/Edit/Discard like Cloudflare.
- Compose uses Cloudflare's dock panel anatomy and Zero's recipient/alias/attachment/formatting controls.
- First-load skeletons match final geometry; background refresh does not blank warm content.
- Empty and error states are specific to current scope/folder.
- Raw email HTML is sanitized and rendered in the Cloudflare opaque-origin iframe pattern.
- Every responsive transition is driven by pane width, and works in Garden's 240px minimum split as well as expanded panes.
- Visual colors come from Garden semantic tokens; copied dimensions and interaction states remain source-faithful.
