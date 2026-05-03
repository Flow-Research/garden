import { schema } from './db'

type IssueRow = typeof schema.issue.$inferSelect

export type InboxSurfaceItem = {
  id: string
  workspace_id: string
  recipient_type: 'member'
  recipient_id: string
  actor_type: null
  actor_id: null
  type:
    | 'issue_assigned'
    | 'status_changed'
    | 'review_requested'
    | 'task_completed'
    | 'agent_blocked'
  severity: 'action_required' | 'attention' | 'info'
  issue_id: string
  title: string
  body: string | null
  issue_status: IssueRow['status']
  read: boolean
  archived: boolean
  created_at: string
  details: Record<string, string>
}

function issueTimestamp(issue: IssueRow) {
  return issue.updatedAt ?? issue.createdAt ?? new Date()
}

function formatStatusBody(issue: IssueRow) {
  switch (issue.status) {
    case 'blocked':
      return 'Blocked work needs a decision or a dependency cleared.'
    case 'in_review':
      return 'This issue is waiting for review.'
    case 'done':
      return 'Assigned work is marked done.'
    case 'in_progress':
      return 'Work is in motion.'
    default:
      return 'This issue is active in the workspace.'
  }
}

export function buildInboxItemsFromIssues(args: {
  issues: IssueRow[]
  userId: string
  workspaceId: string
}) {
  const { issues, userId, workspaceId } = args

  return sortIssuesByUpdatedAt(
    issues.filter(
      (issue) => issue.assigneeId === userId || issue.createdBy === userId,
    ),
  )
    .slice(0, 24)
    .map((issue) => {
      let type: InboxSurfaceItem['type'] = 'status_changed'
      let severity: InboxSurfaceItem['severity'] = 'info'

      if (issue.assigneeId === userId) {
        type = 'issue_assigned'
        severity = 'attention'
      }

      if (issue.status === 'blocked') {
        type = 'agent_blocked'
        severity = 'action_required'
      } else if (issue.status === 'in_review') {
        type = 'review_requested'
        severity = 'attention'
      } else if (issue.status === 'done') {
        type = 'task_completed'
        severity = 'info'
      }

      return {
        id: `issue:${issue.id}:${type}`,
        workspace_id: workspaceId,
        recipient_type: 'member' as const,
        recipient_id: userId,
        actor_type: null,
        actor_id: null,
        type,
        severity,
        issue_id: issue.id,
        title: issue.title,
        body: formatStatusBody(issue),
        issue_status: issue.status,
        read: false,
        archived: false,
        created_at: issueTimestamp(issue).toISOString(),
        details: {
          issue_number: String(issue.number),
          priority: issue.priority ?? 'medium',
          status: issue.status ?? 'backlog',
        },
      }
    })
}

export function sortIssuesByUpdatedAt<T extends IssueRow>(issues: T[]) {
  return [...issues].sort(
    (left, right) =>
      issueTimestamp(right).getTime() - issueTimestamp(left).getTime(),
  )
}
