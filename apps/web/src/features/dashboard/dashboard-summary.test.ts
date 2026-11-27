import { describe, expect, it } from 'vitest'
import type { IssueStatus } from '@garden/core/types'
import { summarizeIssueCounts } from './dashboard-summary'

const issues = (
  counts: Partial<Record<IssueStatus, number>>,
): { status: IssueStatus }[] =>
  Object.entries(counts).flatMap(([status, count]) =>
    Array.from({ length: count ?? 0 }, () => ({
      status: status as IssueStatus,
    })),
  )

describe('summarizeIssueCounts', () => {
  it('excludes cancelled issues from open and total counts', () => {
    const summary = summarizeIssueCounts(
      issues({
        todo: 3,
        in_progress: 2,
        in_review: 1,
        blocked: 1,
        done: 4,
        cancelled: 5,
      }),
    )

    expect(summary).toEqual({
      totalIssues: 11,
      openIssues: 7,
      blockedIssues: 1,
      completedIssues: 4,
    })
    expect(summary.openIssues + summary.completedIssues).toBe(
      summary.totalIssues,
    )
  })
})
