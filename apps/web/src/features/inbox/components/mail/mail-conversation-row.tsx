// Adapted from Zero (MIT) and Cloudflare Agentic Inbox (Apache-2.0).
// Pinned sources and notices: docs/architecture/garden-mail-ui-sources.md and THIRD_PARTY_NOTICES.md.

import { Button } from '@garden/ui/components/ui/button'
import { cn } from '@garden/ui/lib/utils'
import {
  Archive,
  CircleAlert,
  Mail,
  MailOpen,
  Star,
  Trash2,
} from 'lucide-react'
import type { KeyboardEvent, MouseEvent } from 'react'
import { MailAvatar } from './mail-avatar'
import type { MailConversationSummaryView } from './types'

export type MailConversationRowProps = {
  conversation: MailConversationSummaryView
  selected: boolean
  bulkSelected?: boolean
  onOpen: () => void
  onToggleSelected?: () => void
  onToggleStar: () => void
  onToggleImportant?: () => void
  onToggleRead: () => void
  onArchive: () => void
  onDelete?: () => void
}

/**
 * Dense Zero-style conversation row with Cloudflare's keyboard activation.
 * Nested actions stop propagation so read/archive/star operations never open
 * the thread accidentally.
 */
export function MailConversationRow({
  conversation,
  selected,
  bulkSelected = false,
  onOpen,
  onToggleSelected,
  onToggleStar,
  onToggleImportant,
  onToggleRead,
  onArchive,
  onDelete,
}: MailConversationRowProps) {
  const activate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onOpen()
  }

  const action = (callback: () => void) => (event: MouseEvent) => {
    event.stopPropagation()
    callback()
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={selected ? 'true' : undefined}
      aria-label={`${conversation.unread ? 'Unread' : 'Read'} conversation: ${conversation.subject}`}
      onClick={onOpen}
      onKeyDown={activate}
      className={cn(
        'group relative mx-1 min-h-24 cursor-pointer rounded-lg border-b px-3 py-2 text-left text-sm outline-none transition-colors last:border-b-0',
        'hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/60',
        (selected || bulkSelected) &&
          'bg-sidebar-accent text-sidebar-accent-foreground',
        !conversation.unread && !selected && 'text-foreground/65',
      )}
    >
      <div className="flex min-w-0 gap-3">
        <button
          type="button"
          aria-label={
            bulkSelected ? 'Remove from selection' : 'Select conversation'
          }
          onClick={action(onToggleSelected ?? onOpen)}
          className="mt-0.5 shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <MailAvatar
            people={conversation.participants}
            selected={bulkSelected}
          />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span
              className={cn(
                'truncate text-sm',
                conversation.unread ? 'font-semibold' : 'font-medium',
              )}
            >
              {conversation.participants
                .map((person) => person.name || person.address)
                .join(', ')}
            </span>
            {conversation.unread ? (
              <span
                aria-label="Unread"
                className="size-1.5 shrink-0 rounded-full bg-primary"
              />
            ) : null}
            {conversation.messageCount > 1 ? (
              <span className="shrink-0 text-xs text-muted-foreground">
                [{conversation.messageCount}]
              </span>
            ) : null}
            {conversation.draft ? (
              <span className="shrink-0 text-xs font-medium text-primary">
                Draft
              </span>
            ) : null}
            {conversation.needsReply ? (
              <span className="shrink-0 text-xs font-medium text-warning">
                Needs reply
              </span>
            ) : null}
            <time className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
              {conversation.dateLabel}
            </time>
          </div>

          <div
            className={cn(
              'mt-1 truncate',
              conversation.unread ? 'font-medium text-foreground' : '',
            )}
          >
            {conversation.subject || '(no subject)'}
          </div>

          <div className="mt-1.5 flex min-w-0 items-center gap-1.5">
            <p className="line-clamp-2 min-w-0 flex-1 text-xs leading-4 text-muted-foreground">
              {conversation.snippet}
            </p>
            {conversation.labels?.slice(0, 2).map((label) => (
              <span
                key={label.id}
                className="max-w-24 shrink-0 truncate rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                style={
                  label.color
                    ? { borderLeft: `2px solid ${label.color}` }
                    : undefined
                }
              >
                {label.name}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="absolute top-1.5 right-2 z-10 hidden items-center gap-0.5 rounded-xl border bg-background p-1 shadow-sm group-hover:flex group-focus-within:flex">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={conversation.starred ? 'Unstar' : 'Star'}
          title={conversation.starred ? 'Unstar' : 'Star'}
          onClick={action(onToggleStar)}
        >
          <Star
            className={cn(
              'size-3.5',
              conversation.starred &&
                'fill-yellow-400 text-yellow-500 dark:text-yellow-400',
            )}
          />
        </Button>
        {onToggleImportant ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={
              conversation.important ? 'Mark not important' : 'Mark important'
            }
            title={
              conversation.important ? 'Mark not important' : 'Mark important'
            }
            onClick={action(onToggleImportant)}
          >
            <CircleAlert
              className={cn(
                'size-3.5',
                conversation.important &&
                  'fill-orange-400 text-orange-500 dark:text-orange-400',
              )}
            />
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={conversation.unread ? 'Mark read' : 'Mark unread'}
          title={conversation.unread ? 'Mark read' : 'Mark unread'}
          onClick={action(onToggleRead)}
        >
          {conversation.unread ? (
            <MailOpen className="size-3.5" />
          ) : (
            <Mail className="size-3.5" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Archive"
          title="Archive"
          onClick={action(onArchive)}
        >
          <Archive className="size-3.5" />
        </Button>
        {onDelete ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Delete"
            title="Delete"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={action(onDelete)}
          >
            <Trash2 className="size-3.5" />
          </Button>
        ) : null}
      </div>
    </div>
  )
}
