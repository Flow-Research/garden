'use client'

import { cn } from '@garden/ui/lib/utils'
import { IconSearch } from '@tabler/icons-react'
import { Kbd, KbdGroup } from '@garden/ui/components/ui/kbd'
import { SidebarMenuButton } from '@garden/ui/components/ui/sidebar'
import { useSearchStore } from './search-store'

export function SearchTrigger({ className }: { className?: string } = {}) {
  return (
    <SidebarMenuButton
      tooltip="Search"
      className={cn(
        'text-muted-foreground group-data-[collapsible=icon]:size-10! group-data-[collapsible=icon]:p-0!',
        className,
      )}
      onClick={() => useSearchStore.getState().setOpen(true)}
    >
      <IconSearch className="size-4" />
      <span className="group-data-[collapsible=icon]:hidden">Search...</span>
      <KbdGroup className="ml-auto group-data-[collapsible=icon]:hidden">
        <Kbd>⌘</Kbd>
        <Kbd>K</Kbd>
      </KbdGroup>
    </SidebarMenuButton>
  )
}
