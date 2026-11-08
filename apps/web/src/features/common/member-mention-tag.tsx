import { useQuery } from '@tanstack/react-query'
import { useWorkspaceId } from '@garden/app-state/hooks'
import { cn } from '@garden/ui/lib/utils'
import { agentListOptions, memberListOptions } from '@/lib/workspace/queries'

type MentionActorType = 'member' | 'agent' | 'all'

const TYPE_STYLES: Record<MentionActorType, string> = {
  member:
    'bg-badge-green-background/25 text-success shadow-2 dark:bg-badge-green-background/15 dark:text-text-success-tertiary',
  agent:
    'bg-badge-blue-background/25 text-foreground shadow-2 dark:bg-badge-blue-background/15',
  all: 'bg-badge-yellow-background/30 text-foreground shadow-2 dark:bg-badge-yellow-background/15',
}

/**
 * Renders a persisted mention with the same compact foliage tag in editors,
 * saved markdown, and chat. Names resolve from the existing warm workspace
 * member/agent queries so mentions update without creating a parallel cache;
 * the serialized label remains a resilient offline/deleted-user fallback.
 */
export function MemberMentionTag({
  type,
  id,
  label,
  className,
}: {
  type: MentionActorType
  id: string
  label?: string
  className?: string
}) {
  const workspaceId = useWorkspaceId()
  const membersQuery = useQuery({
    ...memberListOptions(workspaceId),
    enabled: type === 'member',
  })
  const agentsQuery = useQuery({
    ...agentListOptions(workspaceId),
    enabled: type === 'agent',
  })

  const resolvedLabel =
    type === 'all'
      ? 'All members'
      : type === 'member'
        ? membersQuery.data?.find((member) => member.user_id === id)?.name
        : agentsQuery.data?.find((agent) => agent.id === id)?.name

  return (
    <span
      data-mention-type={type}
      data-mention-id={id}
      className={cn(
        'mx-0.5 inline-flex h-[1.375rem] max-w-48 select-none items-center gap-1 rounded-full px-2 align-middle text-xs font-medium leading-none',
        TYPE_STYLES[type],
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          type === 'member'
            ? 'bg-success'
            : type === 'agent'
              ? 'bg-badge-blue-background'
              : 'bg-icon-warning-tertiary',
        )}
      />
      <span className="truncate">@{resolvedLabel ?? label ?? id}</span>
    </span>
  )
}
