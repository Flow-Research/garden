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
4. Confirm that Activity contains task changes and conversation, while Comments
   excludes property changes. A comment focus URL must select Comments and bring
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
