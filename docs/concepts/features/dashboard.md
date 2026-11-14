---
title: Workspace overview
description: Home dashboard metrics, issue distributions, activity, agents, and connections.
status: current
owner: "@Umoren"
last_reviewed: 2026-11-14
---

Home shows an Overview heading, four metric cards, two issue charts, and two columns of workspace details. Recent tasks and recent activity sit in the left column; agents and connections sit in the right. Narrow screens stack the charts and detail columns, with metrics in two columns.

## Metrics and distributions

Open Work excludes done and cancelled issues. Its completion bar shows done issues as a share of non-cancelled issues. Blocked uses a warning treatment when work needs attention. Agents shows the non-archived count and available skills. Connected Apps shows connected and pending counts.

Metric cards use compact values, small icon tiles, and aligned footer dividers so the charts remain visible near the top of Home. The completion bar replaces Open Work's footer divider. Blocked keeps its label and supporting text neutral, with a subtle warning border and emphasis on the count and icon. Each card is one keyboard-focusable button with visible hover and focus states; loading placeholders reserve the same layout.

The status chart uses one stacked bar, followed by status counts in workflow order. Cancelled issues appear separately and are excluded from the bar and total. Priority bars show percentages of all tasks, including completed and cancelled tasks, matching the existing distribution query. Their heading explicitly describes that scope. Bar widths use each bucket's share of the total, rather than scaling against the largest bucket.

Charts and lists share the metric cards' smaller corners and padding. Sentence-case headings separate sections from their quieter count chips and actions. Status counts use compact rows without repeated rules; priority bars are thin, with aligned percentages and counts. Recent tasks align status and time columns, while long titles truncate and expose the full text on hover. Resource rows use small square icon tiles and subdued status badges. Activity icons distinguish assignments, failures, blocked work, completion, conversations, and connector requests.

## Navigation and loading

Metric cards open tasks, blocked tasks, agents, or connections. Blocked resets task scope and filters before selecting blocked status. Recent task rows open task details. Activity rows open their linked task, or the inbox item when no task is attached. View all opens tasks; Manage and connection rows open connections.

Overview, charts, activity, and resources retain independent query caching, suspense, and retry boundaries. Loading placeholders follow the same panel arrangement. No dashboard writes or permission changes are introduced by the presentation.

Colors use the shared semantic tokens in both light and dark modes. See [design direction](../design/design-direction.md) and [design tokens](../../reference/design-tokens.md).
