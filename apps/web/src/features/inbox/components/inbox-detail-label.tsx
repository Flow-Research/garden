'use client'

import { STATUS_CONFIG, PRIORITY_CONFIG } from '@garden/core/issues/config'
import { useActorName } from '@/lib/workspace/hooks'
import { StatusIcon, PriorityIcon } from '../../issues/components'
import type {
  InboxItem,
  InboxItemType,
  IssueStatus,
  IssuePriority,
} from '@garden/core/types'

const typeLabels: Record<InboxItemType, string> = {
  issue_assigned: 'Assigned',
  unassigned: 'Unassigned',
  assignee_changed: 'Assignee changed',
  status_changed: 'Status changed',
  priority_changed: 'Priority changed',
  due_date_changed: 'Due date changed',
  new_comment: 'New comment',
  mentioned: 'Mentioned',
  review_requested: 'Approval needed',
  waiting_for_input: 'Question waiting',
  wp_review: 'Ready for review',
  task_completed: 'Task completed',
  task_failed: 'Task failed',
  agent_blocked: 'Agent blocked',
  agent_completed: 'Agent completed',
  reaction_added: 'Reacted',
}

export { typeLabels }

function shortDate(dateStr: string): string {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

export function InboxDetailLabel({ item }: { item: InboxItem }) {
  const { getActorName } = useActorName()
  const details = item.details ?? {}

  switch (item.type) {
    case 'status_changed': {
      if (!details.to) return <span>{typeLabels[item.type]}</span>
      const label =
        STATUS_CONFIG[details.to as IssueStatus]?.label ?? details.to
      return (
        <span className="inline-flex items-center gap-1">
          Set status to
          <StatusIcon status={details.to as IssueStatus} className="h-3 w-3" />
          {label}
        </span>
      )
    }
    case 'priority_changed': {
      if (!details.to) return <span>{typeLabels[item.type]}</span>
      const label =
        PRIORITY_CONFIG[details.to as IssuePriority]?.label ?? details.to
      return (
        <span className="inline-flex items-center gap-1">
          Set priority to
          <PriorityIcon
            priority={details.to as IssuePriority}
            className="h-3 w-3"
          />
          {label}
        </span>
      )
    }
    case 'issue_assigned': {
      if (details.new_assignee_id) {
        return (
          <span>
            Assigned to{' '}
            {getActorName(
              details.new_assignee_type ?? 'member',
              details.new_assignee_id,
            )}
          </span>
        )
      }
      return <span>{typeLabels[item.type]}</span>
    }
    case 'unassigned':
      return <span>Removed assignee</span>
    case 'assignee_changed': {
      if (details.new_assignee_id) {
        return (
          <span>
            Assigned to{' '}
            {getActorName(
              details.new_assignee_type ?? 'member',
              details.new_assignee_id,
            )}
          </span>
        )
      }
      return <span>{typeLabels[item.type]}</span>
    }
    case 'due_date_changed': {
      if (details.to)
        return <span>Set due date to {shortDate(details.to)}</span>
      return <span>Removed due date</span>
    }
    case 'new_comment': {
      if (item.body) return <span>{item.body}</span>
      return <span>{typeLabels[item.type]}</span>
    }
    case 'mentioned': {
      if (item.body) return <span>{item.body}</span>
      return <span>{typeLabels[item.type]}</span>
    }
    case 'waiting_for_input':
      return <span>{item.body ?? 'Garden is paused on a question.'}</span>
    case 'wp_review': {
      const wpType = details.work_product_type
      const noun = wpType ? wpType.replaceAll('_', ' ') : 'Draft'
      return <span>{`${noun.charAt(0).toUpperCase()}${noun.slice(1)} ready for review`}</span>
    }
    case 'review_requested':
      return <span>{item.body ?? 'A capability needs your approval to run.'}</span>
    case 'task_failed':
      return <span>{item.body ?? 'A run failed. Check the timeline for details.'}</span>
    case 'agent_blocked':
      return <span>{item.body ?? 'This issue needs a decision before work can resume.'}</span>
    case 'task_completed':
      return <span>{item.body ?? typeLabels[item.type]}</span>
    case 'reaction_added': {
      const emoji = details.emoji
      if (emoji) return <span>Reacted {emoji} to your comment</span>
      return <span>{typeLabels[item.type]}</span>
    }
    default:
      return <span>{typeLabels[item.type] ?? item.type}</span>
  }
}
