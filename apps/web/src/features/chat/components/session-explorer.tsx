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
import { GripVertical, Pencil, Plus, Trash2 } from 'lucide-react'
import { useChatStore } from '@garden/core/chat'
import { Button } from '@garden/ui/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@garden/ui/components/ui/context-menu'
import { cn } from '@garden/ui/lib/utils'
import {
  useAgentSessions,
  type AgentChatSession,
} from '../use-agent-chat-sessions'
import { isDraftChatSessionId, startNewChat } from '../draft-session'

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
  onSelect,
  onRename,
  onDelete,
}: {
  session: AgentChatSession
  active: boolean
  onSelect: () => void
  onRename: () => void
  onDelete: () => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: session.id })

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
            'group flex w-full items-start gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors',
            active
              ? 'border-border bg-accent text-accent-foreground'
              : 'border-transparent hover:bg-accent/60',
          )}
        >
          <span
            aria-hidden="true"
            className="mt-0.5 inline-flex shrink-0 cursor-grab text-muted-foreground/70 transition-colors group-hover:text-muted-foreground"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-3.5" />
          </span>
          <div className="mt-0.5 shrink-0">
            <SessionStatusDot session={session} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{session.title}</span>
              {session.unread && !active ? (
                <span className="size-1.5 shrink-0 rounded-full bg-primary" />
              ) : null}
            </div>
            <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
              {session.lastMessage || 'No messages yet'}
            </div>
          </div>
          <span className="pt-0.5 text-[11px] text-muted-foreground">
            {formatTimeAgo(session.updatedAt)}
          </span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onRename}>
          <Pencil className="size-4" />
          Rename
        </ContextMenuItem>
        <ContextMenuItem variant="destructive" onClick={onDelete}>
          <Trash2 className="size-4" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function ChatSessionExplorer({
  onActivate,
}: {
  onActivate?: () => void
}) {
  const activeSessionId = useChatStore((state) => state.activeSessionId)
  const setActiveSession = useChatStore((state) => state.setActiveSession)
  const {
    deleteSession,
    renameSession,
    reorderSessions: persistOrder,
    sessions,
  } = useAgentSessions()

  const activeSessions = useMemo(() => sessions, [sessions])
  const draftIsActive = isDraftChatSessionId(activeSessionId)
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  )

  const handleCreate = () => {
    startNewChat()
    onActivate?.()
  }

  const handleSelect = (sessionId: string) => {
    setActiveSession(sessionId)
    onActivate?.()
  }

  const handleRename = async (sessionId: string) => {
    const session = activeSessions.find((item) => item.id === sessionId)
    if (!session) return
    const next = window.prompt('Rename chat', session.title)?.trim()
    if (!next || next === session.title) return
    await renameSession.mutateAsync({ sessionId, title: next })
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const fromId = String(event.active.id)
    const toId = event.over ? String(event.over.id) : null
    if (!toId || fromId === toId) return
    const next = reorderSessions(activeSessions, fromId, toId)
    persistOrder(next.map((session) => session.id))
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-3">
        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Active
        </div>
        <Button size="icon-sm" variant="ghost" onClick={handleCreate}>
          <Plus className="size-4" />
        </Button>
      </div>

      {draftIsActive || activeSessions.length > 0 ? (
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
              {draftIsActive ? (
                <div className="flex w-full items-start gap-2 rounded-lg border border-border bg-accent px-3 py-2.5 text-left text-accent-foreground">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 inline-flex shrink-0 text-muted-foreground/70"
                  >
                    <GripVertical className="size-3.5" />
                  </span>
                  <div className="mt-0.5 shrink-0">
                    <SessionStatusDot
                      session={{
                        id: 'draft',
                        title: 'New Chat',
                        createdAt: new Date(0).toISOString(),
                        updatedAt: new Date().toISOString(),
                        lastMessage: '',
                        status: 'idle',
                        unread: false,
                        archivedAt: null,
                      }}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        New Chat
                      </span>
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                      No messages yet
                    </div>
                  </div>
                  <span className="pt-0.5 text-[11px] text-muted-foreground">
                    now
                  </span>
                </div>
              ) : null}
              {activeSessions.map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  active={session.id === activeSessionId}
                  onSelect={() => handleSelect(session.id)}
                  onRename={() => void handleRename(session.id)}
                  onDelete={() => deleteSession.mutate(session.id)}
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
