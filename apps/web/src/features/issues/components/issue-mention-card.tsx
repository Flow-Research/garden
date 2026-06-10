import { useQuery } from '@tanstack/react-query'
import { issueListOptions, issueDetailOptions } from '@/lib/issues/queries'
import { useWorkspaceId } from '@garden/app-state/hooks'
import { useWorkspaceDock } from '@/components/shell/workspace-dock'
import { Badge } from '@garden/ui/components/ui/badge'
import type { IssueStatus } from '@garden/core/types'
import { StatusIcon } from './status-icon'

interface IssueMentionCardProps {
  issueId: string
  /** Fallback text when issue is not in store (e.g. "MUL-7") */
  fallbackLabel?: string
  issue?: {
    id: string
    identifier: string
    title: string
    status: string
  } | null
}

function normalizeIssueStatus(status: string): IssueStatus {
  if (
    status === 'backlog' ||
    status === 'todo' ||
    status === 'in_progress' ||
    status === 'in_review' ||
    status === 'done' ||
    status === 'blocked' ||
    status === 'cancelled'
  ) {
    return status
  }
  return 'backlog'
}

export function IssueMentionCard({
  issueId,
  fallbackLabel,
  issue: providedIssue,
}: IssueMentionCardProps) {
  const wsId = useWorkspaceId()
  const { data: issues = [] } = useQuery(issueListOptions(wsId))
  const listIssue = issues.find((i) => i.id === issueId)
  const dock = useWorkspaceDock()

  // Fetch individual issue when not found in the list (e.g. done issues beyond
  // the first page). Only fires when listIssue is undefined.
  const { data: detailIssue } = useQuery({
    ...issueDetailOptions(wsId, issueId),
    enabled: !listIssue,
  })

  const issue = providedIssue ?? listIssue ?? detailIssue
  const handleOpen = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dock?.openPanel({
      kind: 'issue-detail',
      title: issue?.title ?? fallbackLabel ?? issueId,
      entityId: issueId,
    })
  }

  if (!issue) {
    return (
      <Badge
        variant="outline"
        className="issue-mention mx-0.5 max-w-72 cursor-pointer rounded-md text-xs hover:bg-accent"
        render={<a href={`/issues/${issueId}`} onClick={handleOpen} />}
      >
        <span className="font-medium text-muted-foreground">
          {fallbackLabel ?? issueId.slice(0, 8)}
        </span>
      </Badge>
    )
  }

  return (
    <Badge
      variant="outline"
      className="issue-mention mx-0.5 max-w-72 cursor-pointer rounded-md text-xs hover:bg-accent"
      render={<a href={`/issues/${issueId}`} onClick={handleOpen} />}
    >
      <StatusIcon
        status={normalizeIssueStatus(issue.status)}
        className="h-3.5 w-3.5 shrink-0"
      />
      <span className="font-medium text-muted-foreground shrink-0">
        {issue.identifier}
      </span>
      <span className="text-foreground truncate">{issue.title}</span>
    </Badge>
  )
}
