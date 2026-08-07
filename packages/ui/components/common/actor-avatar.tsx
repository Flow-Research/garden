import { Bot } from 'lucide-react'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@garden/ui/components/ui/avatar'
import { cn } from '@garden/ui/lib/utils'

interface ActorAvatarProps {
  name: string
  initials: string
  avatarUrl?: string | null
  isAgent?: boolean
  size?: number
  className?: string
}

/**
 * Renders a person or agent through the shared avatar primitive so broken image
 * URLs fall through natively instead of maintaining reset effects per consumer.
 */
function ActorAvatar({
  name,
  initials,
  avatarUrl,
  isAgent = false,
  size = 20,
  className,
}: ActorAvatarProps) {
  return (
    <Avatar
      className={cn('font-medium', className)}
      style={{ width: size, height: size }}
      title={name}
      aria-label={name}
    >
      {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
      <AvatarFallback style={{ fontSize: size * 0.45 }}>
        {isAgent ? (
          <Bot
            aria-hidden="true"
            style={{ width: size * 0.55, height: size * 0.55 }}
          />
        ) : (
          initials
        )}
      </AvatarFallback>
    </Avatar>
  )
}

export { ActorAvatar, type ActorAvatarProps }
