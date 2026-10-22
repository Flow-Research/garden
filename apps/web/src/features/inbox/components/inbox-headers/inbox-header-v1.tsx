import { Input } from '@garden/ui/components/ui/input'
import { Label } from '@garden/ui/components/ui/label'
import { Switch } from '@garden/ui/components/ui/switch'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@garden/ui/components/ui/dropdown-menu'
import { Button } from '@garden/ui/components/ui/button'
import { Archive, BookCheck, CheckCheck, ListChecks, MoreHorizontal } from 'lucide-react'


export function InboxListHeaderV1({
    unreadCount,
    search,
    onSearchChange,
    unreadsOnly,
    onUnreadsOnlyChange,
    onMarkAllRead,
    onArchiveAll,
    onArchiveAllRead,
    onArchiveCompleted,
  }: {
    unreadCount: number
    search: string
    onSearchChange: (value: string) => void
    unreadsOnly: boolean
    onUnreadsOnlyChange: (value: boolean) => void
    onMarkAllRead: () => void
    onArchiveAll: () => void
    onArchiveAllRead: () => void
    onArchiveCompleted: () => void
  }) {
    return (
      <div className="flex shrink-0 flex-col gap-3.5 border-b p-4">
        <div className="flex w-full items-center justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <h1 className="text-base font-medium text-foreground">Inbox</h1>
            {unreadCount > 0 && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {unreadCount} unread
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <Label className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
              <span>Unreads</span>
              <Switch
                size="sm"
                checked={unreadsOnly}
                onCheckedChange={onUnreadsOnlyChange}
                className="shadow-none"
              />
            </Label>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground"
                  />
                }
              >
                <MoreHorizontal className="h-4 w-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-auto">
                <DropdownMenuItem onClick={onMarkAllRead}>
                  <CheckCheck className="h-4 w-4" />
                  Mark all as read
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onArchiveAll}>
                  <Archive className="h-4 w-4" />
                  Archive all
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onArchiveAllRead}>
                  <BookCheck className="h-4 w-4" />
                  Archive all read
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onArchiveCompleted}>
                  <ListChecks className="h-4 w-4" />
                  Archive completed
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search notifications…"
          className="h-8 bg-background shadow-none"
        />
      </div>
    )
  }