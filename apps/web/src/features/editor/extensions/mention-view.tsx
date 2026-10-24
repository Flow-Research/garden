/**
 * MentionView — NodeView for rendering @mentions inline in the editor.
 *
 * Member/agent mentions: plain "@Name" text with .mention class styling.
 * Issue mentions: inline card with StatusIcon + identifier + title.
 *
 * Issue card sizing: must fit within the paragraph line box (14px * 1.625
 * = 22.75px). Card uses text-xs (12px) + py-0.5 + border ≈ 22px total.
 * vertical-align: middle is set on the [data-node-view-wrapper] in CSS
 * (not on the <a> tag) because the wrapper is the outermost inline element
 * that participates in line box calculation. Setting it on the inner <a>
 * had no effect since the wrapper was already positioned.
 *
 * Fallback: when issue is not in the Zustand store (deleted or other
 * workspace), the same card style is used with just the identifier from
 * fallbackLabel — no visual degradation to a plain text link.
 */

import { NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { useQuery } from '@tanstack/react-query'
import { issueListOptions, issueDetailOptions } from '@/lib/issues/queries'
import { useWorkspaceId } from '@garden/app-state/hooks'
import {
  issuePath,
  useSurfaceNavigation,
} from '@/features/navigation/use-surface-navigation'
import { Badge } from '@garden/ui/components/ui/badge'
import { StatusIcon } from '../../issues/components/status-icon'
import { MemberMentionTag } from '../../common/member-mention-tag'

export function MentionView({ node }: NodeViewProps) {
  const { type, id, label } = node.attrs

  if (type === 'issue') {
    return (
      <NodeViewWrapper as="span" className="inline">
        <IssueMention issueId={id} fallbackLabel={label} />
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper as="span" className="inline">
      <MemberMentionTag type={type} id={id} label={label} />
    </NodeViewWrapper>
  )
}

function IssueMention({
  issueId,
  fallbackLabel,
}: {
  issueId: string
  fallbackLabel?: string
}) {
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

  const { data: detailIssue } = useQuery({
    ...issueDetailOptions(wsId, issueId),
    enabled: !listIssue,
  })

  const issue = listIssue ?? detailIssue
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    openIssue({
      id: issueId,
      title: issue?.title ?? fallbackLabel ?? issueId,
    })
  }

  const cardClass =
    'issue-mention mx-0.5 max-w-72 cursor-pointer rounded-md text-xs hover:bg-accent'

  if (!issue) {
    return (
      <Badge
        variant="outline"
        className={cardClass}
        render={<button type="button" onClick={handleClick} />}
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
      className={cardClass}
      render={<a href={issuePath(issueId)} onClick={handleClick} />}
    >
      <StatusIcon status={issue.status} className="size-3.5 shrink-0" />
      <span className="font-medium text-muted-foreground shrink-0">
        {issue.identifier}
      </span>
      <span className="text-foreground truncate">{issue.title}</span>
    </Badge>
  )
}
