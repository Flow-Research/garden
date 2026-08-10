// Adapted from Cloudflare Agentic Inbox's EmailPanelToolbar (Apache-2.0).
// See THIRD_PARTY_NOTICES.md.

import { Button } from '@garden/ui/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@garden/ui/components/ui/dropdown-menu'
import { cn } from '@garden/ui/lib/utils'
import {
  ArrowLeft,
  Archive,
  ChevronDown,
  Code2,
  Forward,
  Mail,
  MailOpen,
  Reply,
  ReplyAll,
  Star,
  Trash2,
  X,
} from 'lucide-react'
import type { MailFolderAction } from './types'

export type MailDetailToolbarProps = {
  compact: boolean
  starred: boolean
  unread: boolean
  folders?: MailFolderAction[]
  onBack?: () => void
  onClose?: () => void
  onReply?: () => void
  onReplyAll?: () => void
  onForward?: () => void
  onToggleStar: () => void
  onToggleRead: () => void
  onArchive?: () => void
  onMove?: (folderId: string) => void
  onViewSource?: () => void
  onDelete?: () => void
}

function ToolbarButton({
  label,
  onClick,
  children,
  className,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={className}
    >
      {children}
    </Button>
  )
}

/** Cloudflare toolbar ordering, with Back/Close decided by pane width upstream. */
export function MailDetailToolbar({
  compact,
  starred,
  unread,
  folders = [],
  onBack,
  onClose,
  onReply,
  onReplyAll,
  onForward,
  onToggleStar,
  onToggleRead,
  onArchive,
  onMove,
  onViewSource,
  onDelete,
}: MailDetailToolbarProps) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-0.5 border-b bg-background px-2">
      {compact && onBack ? (
        <ToolbarButton label="Back to conversations" onClick={onBack}>
          <ArrowLeft />
        </ToolbarButton>
      ) : null}
      {!compact && onClose ? (
        <ToolbarButton label="Close conversation" onClick={onClose}>
          <X />
        </ToolbarButton>
      ) : null}
      {(compact && onBack) || (!compact && onClose) ? (
        <span className="mx-1 h-5 w-px bg-border" />
      ) : null}

      {onReply ? (
        <ToolbarButton label="Reply" onClick={onReply}>
          <Reply />
        </ToolbarButton>
      ) : null}
      {onReplyAll ? (
        <ToolbarButton label="Reply all" onClick={onReplyAll}>
          <ReplyAll />
        </ToolbarButton>
      ) : null}
      {onForward ? (
        <ToolbarButton label="Forward" onClick={onForward}>
          <Forward />
        </ToolbarButton>
      ) : null}

      <span className="mx-1 h-5 w-px bg-border" />
      <ToolbarButton label={starred ? 'Unstar' : 'Star'} onClick={onToggleStar}>
        <Star className={cn(starred && 'fill-yellow-400 text-yellow-500')} />
      </ToolbarButton>
      <ToolbarButton
        label={unread ? 'Mark read' : 'Mark unread'}
        onClick={onToggleRead}
      >
        {unread ? <MailOpen /> : <Mail />}
      </ToolbarButton>
      {onArchive ? (
        <ToolbarButton label="Archive" onClick={onArchive}>
          <Archive />
        </ToolbarButton>
      ) : null}

      {folders.length > 0 && onMove ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                aria-label="Move conversation"
                className="px-1.5"
              />
            }
          >
            Move
            <ChevronDown className="size-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {folders.map((folder) => (
              <DropdownMenuItem
                key={folder.id}
                onClick={() => onMove(folder.id)}
              >
                {folder.icon}
                {folder.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <div className="flex-1" />
      {onViewSource ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="More conversation actions"
              />
            }
          >
            <ChevronDown />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={onViewSource}>
              <Code2 />
              View source
            </DropdownMenuItem>
            {onDelete ? <DropdownMenuSeparator /> : null}
            {onDelete ? (
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <Trash2 />
                Delete
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : onDelete ? (
        <ToolbarButton
          label="Delete"
          onClick={onDelete}
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 />
        </ToolbarButton>
      ) : null}
    </div>
  )
}
