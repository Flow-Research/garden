import { schema } from './db'

type IssueRow = typeof schema.issue.$inferSelect

function issueTimestamp(issue: IssueRow) {
  return issue.updatedAt ?? issue.createdAt ?? new Date()
}

export function sortIssuesByUpdatedAt<T extends IssueRow>(issues: T[]) {
  return [...issues].sort(
    (left, right) =>
      issueTimestamp(right).getTime() - issueTimestamp(left).getTime(),
  )
}
