import { useQuery } from '@tanstack/react-query'
import { issueListOptions, issueDetailOptions } from '@/lib/issues/queries'
import { useWorkspaceId } from '@garden/app-state/hooks'
import {
  issuePath,
  useSurfaceNavigation,
} from '@/features/navigation/use-surface-navigation'
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
    status === 'todo' ||
    status === 'in_progress' ||
    status === 'in_review' ||
    status === 'done' ||
    status === 'blocked' ||
    status === 'cancelled'
  ) {
    return status
  }
  return 'todo'
}

export function IssueMentionCard({
  issueId,
  fallbackLabel,
  issue: providedIssue,
}: IssueMentionCardProps) {
  const wsId = useWorkspaceId()
  // Only this issue from the list cache, and only if the list is already
  // loaded: subscribing to the whole list re-rendered every mention on any
  // issue change, and could fetch the full list just to show one title.
  // The detail query below covers an issue the cache does not have.
  const { data: listIssue } = useQuery({
    ...issueListOptions(wsId),
    enabled: false,
    select: (data) => data.issues.find((i) => i.id === issueId),
  })
  const { openIssue } = useSurfaceNavigation()

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
    openIssue({
      id: issueId,
      title: issue?.title ?? fallbackLabel ?? issueId,
    })
  }

  if (!issue) {
    return (
      <Badge
        variant="outline"
        className="issue-mention mx-0.5 max-w-72 cursor-pointer rounded-md text-xs hover:bg-accent"
        render={<button type="button" onClick={handleOpen} />}
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
      render={<a href={issuePath(issueId)} onClick={handleOpen} />}
    >
      <StatusIcon
        status={normalizeIssueStatus(issue.status)}
        className="size-3.5 shrink-0"
      />
      <span className="font-medium text-muted-foreground shrink-0">
        {issue.identifier}
      </span>
      <span className="text-foreground truncate">{issue.title}</span>
    </Badge>
  )
}
