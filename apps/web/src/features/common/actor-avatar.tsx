import { ActorAvatar as ActorAvatarBase } from '@garden/ui/components/common/actor-avatar'
import { useActorName } from '@/lib/workspace/hooks'

interface ActorAvatarProps {
  actorType: string
  actorId: string | null
  /** Prefer over resolved member/agent name (connector comments). */
  label?: string | null
  size?: number
  className?: string
}

export function ActorAvatar({
  actorType,
  actorId,
  label,
  size,
  className,
}: ActorAvatarProps) {
  const { getActorName, getActorInitials, getActorAvatarUrl } = useActorName()
  const resolvedId = actorId ?? ''
  const name = label?.trim() || getActorName(actorType, resolvedId)
  return (
    <ActorAvatarBase
      name={name}
      initials={
        label?.trim()
          ? name
              .split(' ')
              .map((w) => w[0])
              .join('')
              .toUpperCase()
              .slice(0, 2)
          : getActorInitials(actorType, resolvedId)
      }
      avatarUrl={getActorAvatarUrl(actorType, resolvedId)}
      isAgent={actorType === 'agent'}
      size={size}
      className={className}
    />
  )
}
