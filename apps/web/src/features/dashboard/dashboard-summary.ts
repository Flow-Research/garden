import { isOpenIssueStatus } from '@garden/core/issues/config'

/**
 * Issue counts behind Home's "Open Work" card and its "N total, M done" line.
 *
 * Before: open was `status !== 'done'` and total was every row, so cancelled
 * issues inflated both (garden-dev showed 198 open against 74 real tasks).
 * After: open uses the shared `isOpenIssueStatus` set (todo, in_progress,
 * in_review, blocked) and total counts only non-cancelled issues, so
 * `open + done === total`. Cancelled work was abandoned, not delivered, so it
 * belongs in neither number. A null status is treated as `todo`, matching the
 * status chart.
 */
export function summarizeIssueCounts(issues: { status: string | null }[]) {
  const statuses = issues.map((issue) => issue.status ?? 'todo')
  return {
    totalIssues: statuses.filter((status) => status !== 'cancelled').length,
    openIssues: statuses.filter(isOpenIssueStatus).length,
    blockedIssues: statuses.filter((status) => status === 'blocked').length,
    completedIssues: statuses.filter((status) => status === 'done').length,
  }
}
