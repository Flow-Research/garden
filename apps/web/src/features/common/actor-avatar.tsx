import { ActorAvatar as ActorAvatarBase } from '@garden/ui/components/common/actor-avatar'
import { useActorName } from '@/lib/workspace/hooks'

interface ActorAvatarProps {
  actorType: string
  actorId: string
  size?: number
  className?: string
}

export function ActorAvatar({
  actorType,
  actorId,
  size,
  className,
}: ActorAvatarProps) {
  const { getActorName, getActorInitials, getActorAvatarUrl } = useActorName()
  return (
    <ActorAvatarBase
      name={getActorName(actorType, actorId)}
      initials={getActorInitials(actorType, actorId)}
      avatarUrl={getActorAvatarUrl(actorType, actorId)}
      isAgent={actorType === 'agent'}
      size={size}
      className={className}
    />
  )
}
