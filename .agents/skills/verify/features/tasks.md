# Task detail

## Preconditions

Run `pnpm run doctor`. Use the running local stack and a signed-in test workspace.
Create one unassigned task, one task with sub-tasks, and one assigned to an agent.

## Task properties and conversation

1. Open a task from `/tasks`. Confirm the centered title, description, compact
   status, priority, and due date badges, and the header's **New Sub-task** action.
2. Change each badge and reload. Confirm the stored values through
   `GET /api/issues/<id>`. Edit the title and description and repeat.
3. Open **Comments**, type a draft, switch to **Activity**, and return. The draft
   must remain. Submit it and confirm that the count updates and the comment
   survives reload. Edit it, reply, react, attach a file, and delete a test reply.
4. Confirm that Activity contains task changes and one "replied" row per agent
   reply, while Comments holds every comment and excludes property changes.
   Selecting a "replied" row must open Comments and highlight that reply. A comment focus URL must select Comments and bring
   the target into view. With an empty timeline, each tab must show its own empty
   message without scheduled automation or sample meeting content.
5. Subscribe and unsubscribe. Open **Manage subscribers** and change a test
   participant. Confirm the persisted subscriber list after reload.
6. Create a sub-task, open it, and follow its parent link back. Confirm that the
   actions menu still offers parent selection, linking an existing sub-task,
   copy link, and delete. Team tasks must retain navigation to their Team.
7. Toggle properties. Confirm that assignee, project, parent, and creation
   details remain accessible. At 390px wide the properties open as a sheet, tabs
   and actions remain usable, and the page has no horizontal overflow.

## Agent work

1. Open the agent-assigned task and start a run through the existing status flow.
2. Switch both tabs. Run progress, stop, questions, permission approvals, plans,
   and work products must remain accessible above them.
3. Answer a question and review an output. Confirm their stored outcomes and
   existing approval, apply, and save actions. Refuse an approval and confirm
   that the existing permission boundary still handles it.

## Automated proof

```bash
pnpm --filter @garden/web test src/features/issues/components/issue-detail.test.tsx
```

The component suite covers tab filtering, drafts, inline status updates, empty
states, failed writes, retry, parent links, and approval availability. Record
browser and persisted-write evidence separately.

## Responsive layout regression

Use a task with a long title and an unbroken description. Add a comment with an
unbroken word, a wide Markdown table, a code block, and a reply. At widths of
320, 390, 540, 768, and 1440px, open both tabs and run this browser assertion.
It checks rendered bounds, including the loading wrapper that contains the
page. Tables and code may scroll inside their containers.

```js
const viewport = document.documentElement.clientWidth
const main = document.querySelector('main')
const detail = main.querySelector('[data-boneyard-content]')
const title = main.querySelector('[aria-label="Issue title"]')
const failures = []
if (document.documentElement.scrollWidth > viewport + 1) failures.push('page overflows')
const mainBounds = main.getBoundingClientRect()
if (mainBounds.left < -1 || mainBounds.right > viewport + 1) failures.push('main offscreen')
if (main.scrollWidth > main.clientWidth + 1) failures.push('main overflows')
if (detail.scrollWidth > detail.clientWidth + 1) failures.push('detail overflows')
if (title.scrollHeight > title.clientHeight + 1) failures.push('title clips')
for (const button of main.querySelectorAll('header button, [role="tab"]')) {
  const rect = button.getBoundingClientRect()
  if (rect.width && (rect.left < -1 || rect.right > viewport + 1)) {
    failures.push(`${button.getAttribute('aria-label') ?? button.textContent} offscreen`)
  }
}
if (failures.length) throw new Error(failures.join(', '))
```

At 320 and 390px, edit the wrapping title and press Enter. Read it back through
`GET /api/issues/<id>`. Open Properties, confirm the dialog stays within the
viewport, change a property, and close it with the visible Close button. Create
a comment and reply, then reload to confirm both persist.

## Sticky conversation navigation

At phone and desktop widths, scroll a long task until the Activity and Comments
bar reaches the top of the task body. Scroll farther and confirm that both tabs
and subscriber controls remain beneath the task header without content showing
through. Switch tabs while pinned. Scroll back above the conversation and confirm
that the bar returns to its original position.

## Comment card actions

Check the avatar/author/time header, upper-right overflow menu, and reaction/Reply
row below the body at 320px and desktop widths. Use the overflow menu to collapse
and expand a thread, copy text, and edit your own comment. Confirm that the
reaction picker opens from the footer, existing reactions still toggle, Reply
opens the composer, and attachments remain accessible.
