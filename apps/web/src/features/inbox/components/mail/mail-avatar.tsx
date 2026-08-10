import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@garden/ui/components/ui/avatar'
import { Users } from 'lucide-react'
import type { MailAddressView } from './types'

function initials(address: MailAddressView): string {
  const source = address.name?.trim() || address.address.trim()
  const parts = source.split(/\s+/).filter(Boolean)
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}

export function MailAvatar({
  people,
  selected = false,
}: {
  people: MailAddressView[]
  selected?: boolean
}) {
  const first = people[0]

  return (
    <Avatar size="sm" className="size-8">
      {first?.avatarUrl && !selected ? (
        <AvatarImage src={first.avatarUrl} alt="" />
      ) : null}
      <AvatarFallback
        className={
          selected
            ? 'bg-primary text-primary-foreground'
            : 'bg-background text-foreground'
        }
      >
        {selected ? (
          '✓'
        ) : people.length > 1 ? (
          <Users className="size-3.5" />
        ) : (
          initials(first ?? { address: '?' })
        )}
      </AvatarFallback>
    </Avatar>
  )
}
