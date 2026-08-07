import { Avatar, AvatarFallback } from '@garden/ui/components/ui/avatar'
import { cn } from '@garden/ui/lib/utils'

const avatarSizes = {
  sm: 'size-5 text-xs rounded',
  md: 'size-7 text-xs rounded-md',
  lg: 'size-9 text-sm rounded-md',
} as const

interface WorkspaceAvatarProps {
  name: string
  size?: keyof typeof avatarSizes
  className?: string
}

/** Workspace mark using the same resilient avatar foundation as people and agents. */
function WorkspaceAvatar({
  name,
  size = 'sm',
  className,
}: WorkspaceAvatarProps) {
  return (
    <Avatar className={cn(avatarSizes[size], className)} aria-label={name}>
      <AvatarFallback className="rounded-[inherit] border font-semibold">
        {name.trim().charAt(0).toLocaleUpperCase() || 'W'}
      </AvatarFallback>
    </Avatar>
  )
}

export { WorkspaceAvatar, type WorkspaceAvatarProps }
