'use client'

import { useMemo } from 'react'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
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
import {
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

function reorderSessions(
  sessions: AgentChatSession[],
  fromId: string,
  toId: string,
) {
  const fromIndex = sessions.findIndex((session) => session.id === fromId)
  const toIndex = sessions.findIndex((session) => session.id === toId)
  if (fromIndex === -1 || toIndex === -1) return sessions
  return arrayMove(sessions, fromIndex, toIndex)
}

function SessionStatusDot({ session }: { session: AgentChatSession }) {
  const className =
    session.status === 'streaming'
      ? 'bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,0.16)]'
      : session.status === 'submitted'
        ? 'bg-amber-400'
        : session.status === 'error'
          ? 'bg-destructive'
          : session.unread
            ? 'bg-primary'
            : 'bg-muted-foreground/35'

  return <span className={cn('size-2 rounded-full', className)} />
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
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: session.id })

  const menuItems = (
    <>
      <ContextMenuItem onClick={onRename}>
        <Pencil className="size-4" />
        Rename
      </ContextMenuItem>
      <ContextMenuItem onClick={onArchive}>
        <Archive className="size-4" />
        Archive
      </ContextMenuItem>
    </>
  )

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div
            ref={setNodeRef}
            style={{
              transform: CSS.Transform.toString(transform),
              transition,
            }}
            className={cn(isDragging && 'opacity-60')}
            {...attributes}
            {...listeners}
          />
        }
      >
        <div
          role="button"
          tabIndex={0}
          onClick={onSelect}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              onSelect()
            }
          }}
          className={cn(
            'group relative flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm transition-colors',
            active
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
          )}
        >
          <SessionStatusDot session={session} />
          <span className="min-w-0 flex-1 truncate">{session.title}</span>
          <span
            className={cn(
              'shrink-0 text-[11px] tabular-nums text-muted-foreground/70 transition-opacity',
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
                    'absolute right-1 size-6 opacity-0 transition-opacity',
                    'group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100',
                  )}
                />
              }
            >
              <MoreHorizontal className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={onRename}>
                <Pencil className="size-4" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onArchive}>
                <Archive className="size-4" />
                Archive
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>{menuItems}</ContextMenuContent>
    </ContextMenu>
  )
}

export function ChatSessionExplorer({
  onActivate,
}: {
  onActivate?: (session: AgentChatSession) => void
}) {
  const activeSessionId = useChatStore((state) => state.activeSessionId)
  const {
    archiveSession,
    renameSession,
    reorderSessions: persistOrder,
    sessions,
  } = useAgentSessions()

  const activeSessions = useMemo(() => sessions, [sessions])
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  )

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

  const handleArchive = async (sessionId: string) => {
    await archiveSession.mutateAsync(sessionId)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const fromId = String(event.active.id)
    const toId = event.over ? String(event.over.id) : null
    if (!toId || fromId === toId) return
    const next = reorderSessions(activeSessions, fromId, toId)
    persistOrder(next.map((session) => session.id))
  }

  return (
    <div>
      {activeSessions.length > 0 ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={activeSessions.map((session) => session.id)}
            strategy={rectSortingStrategy}
          >
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
          </SortableContext>
        </DndContext>
      ) : (
        <div className="px-3 py-2 text-[12px] text-muted-foreground">
          Start a chat to create your first session.
        </div>
      )}
    </div>
  )
}
