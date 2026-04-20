'use client'

import { cn } from '@garden/ui/lib/utils'
import { IconSearch } from '@tabler/icons-react'
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
      <kbd className="pointer-events-none ml-auto inline-flex h-5 select-none items-center gap-0.5 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground group-data-[collapsible=icon]:hidden">
        <span className="text-xs">⌘</span>K
      </kbd>
    </SidebarMenuButton>
  )
}
