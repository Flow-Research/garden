'use client'

import { useCallback, useMemo } from 'react'
import { Archive, MoreHorizontal, Pencil } from 'lucide-react'
import { useChatStore } from '@garden/core/chat'
import { Button } from '@garden/ui/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@garden/ui/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@garden/ui/components/ui/dropdown-menu'
import { cn } from '@garden/ui/lib/utils'
import { chatSessionDragType } from '@/components/shell/workspace-dock'
import {
  isPendingFirstTurn,
  useAgentSessions,
  type AgentChatSession,
} from '../use-agent-chat-sessions'

function formatTimeAgo(dateStr: string) {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'now'
  if (diffMins < 60) return `${diffMins}m`
  if (diffHours < 24) return `${diffHours}h`
  if (diffDays < 7) return `${diffDays}d`
  return date.toLocaleDateString()
}

function SessionStatusDot({ session }: { session: AgentChatSession }) {
  // Idle sessions show no dot at all.
  if (
    session.status !== 'streaming' &&
    session.status !== 'submitted' &&
    session.status !== 'error' &&
    !session.unread
  ) {
    return null
  }

  const dotClass =
    session.status === 'streaming'
      ? 'bg-blue-400 shadow-[0_0_0_4px_rgba(96,165,250,0.18)]'
      : session.status === 'submitted'
        ? 'bg-orange-400'
        : session.status === 'error'
          ? 'bg-destructive'
          : session.unread
            ? 'bg-emerald-400'
            : ''

  return <span className={cn('size-1.5 shrink-0 rounded-full', dotClass)} />
}

function SessionRow({
  session,
  active,
  onArchive,
  onSelect,
  onRename,
}: {
  session: AgentChatSession
  active: boolean
  onArchive: () => void
  onSelect: () => void
  onRename: () => void
}) {
  // Menu items live inside the row's click-handling div, so React's synthetic
  // event tree bubbles their onClick up to `onSelect`. That made clicking
  // "Archive" also activate the chat panel — which was the source of "the
  // archive button shouldn't have to open the chat first." Stop propagation
  // explicitly on every menu item so the row activation only happens on a
  // genuine row click.
  const stop =
    (handler: () => void) =>
    (event: React.MouseEvent | React.KeyboardEvent) => {
      event.stopPropagation()
      handler()
    }

  const menuItems = (
    <>
      <ContextMenuItem onClick={stop(onRename)}>
        <Pencil className="size-3.5" />
        Rename
      </ContextMenuItem>
      <ContextMenuItem onClick={stop(onArchive)}>
        <Archive className="size-3.5" />
        Archive
      </ContextMenuItem>
    </>
  )

  return (
    <ContextMenu>
      <ContextMenuTrigger render={<div className="w-full" />}>
        <div
          role="button"
          tabIndex={0}
          draggable
          onClick={onSelect}
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData(
              chatSessionDragType,
              JSON.stringify({ id: session.id, title: session.title }),
            )
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              onSelect()
            }
          }}
          className={cn(
            'group relative flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-xs transition-colors',
            active
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
          )}
        >
          <SessionStatusDot session={session} />
          <span className="min-w-0 flex-1 truncate">{session.title}</span>
          <span
            className={cn(
              'shrink-0 text-[10px] tabular-nums text-muted-foreground/70 transition-opacity',
              'group-hover:opacity-0 group-focus-within:opacity-0',
            )}
          >
            {formatTimeAgo(session.updatedAt)}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Chat actions"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                  className={cn(
                    'absolute right-0.5 size-5 opacity-0 transition-opacity',
                    'group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100',
                  )}
                />
              }
            >
              <MoreHorizontal className="size-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="right" sideOffset={4} className="min-w-28">
              <DropdownMenuItem onClick={stop(onRename)}>
                <Pencil className="size-3.5" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem onClick={stop(onArchive)}>
                <Archive className="size-3.5" />
                Archive
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent side="right" sideOffset={4} className="min-w-28">{menuItems}</ContextMenuContent>
    </ContextMenu>
  )
}

export function ChatSessionExplorer({
  onActivate,
  onArchive: onArchiveExternal,
}: {
  onActivate?: (session: AgentChatSession) => void
  onArchive?: (sessionId: string) => void
}) {
  const activeSessionId = useChatStore((state) => state.activeSessionId)
  const { archiveSession, renameSession, sessions, sessionsQuery } =
    useAgentSessions()

  // Hide chats that haven't completed their first turn yet — that covers the
  // pre-warmed "New Chat" we keep ready in the background, the warm chat the
  // user just clicked into but hasn't messaged, and the in-flight chat that
  // is still streaming its first reply (title/lastMessage land at onFinish,
  // not at send). They reappear at the top of the list automatically once
  // `onFinish` writes a real title + lastMessage with a fresh updatedAt.
  const activeSessions = useMemo(
    () => sessions.filter((session) => !isPendingFirstTurn(session)),
    [sessions],
  )
  // Distinguish "loading" from "loaded but empty" so we don't flash the
  // "Start a chat" empty-state while the first fetch is still in flight.
  const isInitialLoad = sessionsQuery.isPending && activeSessions.length === 0

  const handleSelect = (session: AgentChatSession) => {
    onActivate?.(session)
  }

  const handleRename = async (sessionId: string) => {
    const session = activeSessions.find((item) => item.id === sessionId)
    if (!session) return
    const next = window.prompt('Rename chat', session.title)?.trim()
    if (!next || next === session.title) return
    await renameSession.mutateAsync({ sessionId, title: next })
  }

  const handleArchive = useCallback(
    async (sessionId: string) => {
      // Let the parent close the dock panel before the row disappears.
      onArchiveExternal?.(sessionId)
      await archiveSession.mutateAsync(sessionId)
    },
    [archiveSession, onArchiveExternal],
  )

  return (
    <div>
      {activeSessions.length > 0 ? (
        <div className="space-y-1 px-3">
          {activeSessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              active={session.id === activeSessionId}
              onArchive={() => void handleArchive(session.id)}
              onSelect={() => handleSelect(session)}
              onRename={() => void handleRename(session.id)}
            />
          ))}
        </div>
      ) : isInitialLoad ? (
        <div className="space-y-1 px-3" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex h-7 w-full items-center gap-1.5 rounded-md px-2"
            >
              <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-muted-foreground/20" />
              <span className="h-2.5 flex-1 animate-pulse rounded bg-muted-foreground/15" />
            </div>
          ))}
        </div>
      ) : (
        <div className="px-3 py-2 text-[12px] text-muted-foreground">
          Start a chat to create your first session.
        </div>
      )}
    </div>
  )
}
