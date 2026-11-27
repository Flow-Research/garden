# Home dashboard

1. Sign in to a local workspace and open `/home`.
2. Check Overview, four metric cards, and paired status and priority panels.
3. On desktop, check Recent Tasks above Recent Activity in the left column, Agents above Connections in the right. At mobile width, check that panels stack without horizontal overflow and task titles truncate.
4. Check completion against non-cancelled issues. Cancelled has a separate row and no segment in the status bar. Priority percentages use all tasks and the heading states that scope.
5. Click Blocked. Tasks opens with only blocked status selected. Return Home, then check Agents, View all, Manage, and an activity row without a linked issue.
6. Toggle appearance between light and dark; check panel boundaries, warning card, icons, and readable badges.

Expected: counts match workspace data, each action reaches its matching destination, and loading/retry remains local to its dashboard section.

Automated coverage: `apps/web/src/features/dashboard/components/dashboard-page.test.tsx` and `apps/web/src/features/dashboard/dashboard-summary.test.ts`.
