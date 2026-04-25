'use client'

import { useCallback, useEffect, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Result } from 'better-result'
import { useAuthStore } from '@garden/core/auth'
import { useWorkspaceStore } from '@garden/core/workspace'

// Module-scoped warm-chat in-flight latch, keyed by workspace ID.
//
// `useAgentSessions` is called from ~6 places (sidebar, agent screen,
// session explorer, chat-prefetch, search-command, debug drawer). Each
// instance has its own React state — but the warm-chat replenish must be
// a singleton per workspace, otherwise N consumers all see "no warm
// session" on the same render and N parallel mutations fire, flooding
// the thread list with empty New Chat rows.
//
// One Set, shared by all hook instances, gates by workspace ID. Whoever
// arrives first wins the right to spawn the warm chat; everyone else
// no-ops. The latch clears in finally() so a failed mutation doesn't
// permanently block future replenishment.
const warmInFlight = new Set<string>()

export interface AgentChatSession {
  id: string
  workspaceId: string
  ownerUserId: string
  title: string
  agentId: string
  hostName: string
  createdAt: string
  updatedAt: string
  lastMessage: string
  status: 'idle' | 'submitted' | 'streaming' | 'error' | 'archived'
  unread: boolean
  archivedAt: string | null
}

export const NEW_SESSION_TITLE = 'New Chat'

function sortSessions(sessions: AgentChatSession[]) {
  return [...sessions].sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
  )
}

function isWarmSession(session: AgentChatSession | null | undefined) {
  if (!session) return false
  return (
    session.title.trim().toLowerCase() === 'new chat' &&
    session.lastMessage.trim().length === 0 &&
    session.status === 'idle' &&
    !session.archivedAt
  )
}

type ChatThreadRow = {
  id: string
  workspaceId: string
  ownerUserId: string
  title: string
  agentId: string
  hostName: string
  createdAt: string
  updatedAt: string
  lastMessage: string
  archivedAt: string | null
}

async function fetchChatThreadsRaw(workspaceId: string) {
  const url = new URL('/api/chat/threads', window.location.origin)
  url.searchParams.set('workspace_id', workspaceId)

  const response = await fetch(url.toString(), { credentials: 'include' })
  if (!response.ok) {
    throw new Error('Failed to load chat threads')
  }
  return (await response.json()) as ChatThreadRow[]
}

function rowToSession(row: ChatThreadRow): AgentChatSession {
  return {
    ...row,
    status: row.archivedAt ? ('archived' as const) : ('idle' as const),
    unread: false,
  }
}

async function fetchChatThreads(workspaceId: string) {
  const rows = await fetchChatThreadsRaw(workspaceId)
  return sortSessions(rows.filter((row) => !row.archivedAt).map(rowToSession))
}

async function createChatThread(workspaceId: string, title?: string) {
  const url = new URL('/api/chat/threads', window.location.origin)
  url.searchParams.set('workspace_id', workspaceId)

  const response = await fetch(url.toString(), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })

  if (!response.ok) {
    throw new Error('Failed to create chat thread')
  }

  return rowToSession((await response.json()) as ChatThreadRow)
}

async function updateChatThread(
  threadId: string,
  body: Record<string, unknown>,
) {
  const response = await fetch(`/api/chat/threads/${threadId}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error('Failed to update chat thread')
  }

  return rowToSession((await response.json()) as ChatThreadRow)
}

async function deleteChatThread(threadId: string) {
  const response = await fetch(`/api/chat/threads/${threadId}`, {
    method: 'DELETE',
    credentials: 'include',
  })

  if (!response.ok) {
    throw new Error('Failed to delete chat thread')
  }
}

export function useAgentSessions() {
  const qc = useQueryClient()
  const user = useAuthStore((state) => state.user)
  const workspace = useWorkspaceStore((state) => state.workspace)
  const workspaceId = workspace?.id ?? null

  const queryKey = useMemo(
    () => ['chat-threads', workspaceId, user?.id ?? null] as const,
    [workspaceId, user?.id],
  )

  const sessionsQuery = useQuery({
    queryKey,
    enabled: !!workspaceId && !!user?.id,
    queryFn: () => fetchChatThreads(workspaceId as string),
    staleTime: 10_000,
    // Never flash empty while refetching — keep prior data until next payload
    // lands. This is the "don't surface stale fetch" guarantee for warm chats.
    placeholderData: (prev) => prev,
  })

  const createSession = useMutation({
    mutationFn: async (title?: string) => {
      if (!workspaceId) {
        throw new Error('Missing workspace identity')
      }
      return createChatThread(workspaceId, title)
    },
    onSuccess: (created) => {
      qc.setQueryData<AgentChatSession[]>(queryKey, (current = []) =>
        sortSessions([
          created,
          ...current.filter((session) => session.id !== created.id),
        ]),
      )
    },
  })

  const renameSession = useMutation({
    mutationFn: async (input: { sessionId: string; title: string }) =>
      updateChatThread(input.sessionId, { title: input.title }),
    onMutate: async ({ sessionId, title }) => {
      qc.setQueryData<AgentChatSession[]>(queryKey, (current = []) =>
        current.map((session) =>
          session.id === sessionId
            ? { ...session, title, updatedAt: new Date().toISOString() }
            : session,
        ),
      )
    },
    onSuccess: (updated) => {
      qc.setQueryData<AgentChatSession[]>(queryKey, (current = []) =>
        sortSessions(
          current.map((session) =>
            session.id === updated.id ? { ...session, ...updated } : session,
          ),
        ),
      )
    },
  })

  const deleteSession = useMutation({
    mutationFn: async (sessionId: string) => {
      await deleteChatThread(sessionId)
      return sessionId
    },
    onMutate: async (sessionId) => {
      qc.setQueryData<AgentChatSession[]>(queryKey, (current = []) =>
        current.filter((session) => session.id !== sessionId),
      )
    },
  })

  const archiveSession = useMutation({
    mutationFn: async (sessionId: string) =>
      updateChatThread(sessionId, {
        archivedAt: new Date().toISOString(),
      }),
    onMutate: async (sessionId) => {
      qc.setQueryData<AgentChatSession[]>(queryKey, (current = []) =>
        current.filter((session) => session.id !== sessionId),
      )
    },
  })

  const updateSessionPreview = useCallback(
    (input: {
      sessionId: string
      title?: string
      lastMessage?: string
      status?: AgentChatSession['status']
      unread?: boolean
      updatedAt?: string
      persist?: boolean
    }) => {
      const updatedAt = input.updatedAt ?? new Date().toISOString()

      qc.setQueryData<AgentChatSession[]>(queryKey, (current = []) =>
        sortSessions(
          current.map((session) =>
            session.id === input.sessionId
              ? {
                  ...session,
                  ...(input.title ? { title: input.title } : {}),
                  ...(input.lastMessage !== undefined
                    ? { lastMessage: input.lastMessage }
                    : {}),
                  ...(input.status ? { status: input.status } : {}),
                  ...(input.unread !== undefined ? { unread: input.unread } : {}),
                  updatedAt,
                }
              : session,
          ),
        ),
      )

      // Only persist to the server when explicitly requested. Transient UI
      // states like 'submitted' or 'error' stay client-side so we don't
      // overwrite server truth with client clock or status noise.
      if (!input.persist) return

      void Result.tryPromise(() =>
        updateChatThread(input.sessionId, {
          ...(input.title ? { title: input.title } : {}),
          ...(input.lastMessage !== undefined
            ? { lastMessage: input.lastMessage }
            : {}),
          updatedAt,
        }),
      ).then((result) => {
        if (Result.isError(result)) {
          console.warn('[chat.sessions] failed to persist preview', result.error)
        }
      })
    },
    [qc, queryKey],
  )

  const reorderSessions = useCallback(
    (orderedIds: string[]) => {
      qc.setQueryData<AgentChatSession[]>(queryKey, (current = []) => {
        const byId = new Map(current.map((session) => [session.id, session]))
        const ordered = orderedIds.flatMap((id) => {
          const session = byId.get(id)
          return session ? [session] : []
        })
        const remainder = current.filter(
          (session) => !orderedIds.includes(session.id),
        )
        return [...ordered, ...remainder]
      })
    },
    [qc, queryKey],
  )

  const sessions = sessionsQuery.data ?? []

  // Warm-chat guarantee: always keep exactly one idle "New Chat" ahead of the
  // user. When they consume it (first turn), a replacement spins up in the
  // background so the next "new chat" click is instant.
  const warmSession = useMemo(
    () => sessions.find((session) => isWarmSession(session)) ?? null,
    [sessions],
  )

  useEffect(() => {
    if (!workspaceId || !user?.id) return
    if (sessionsQuery.isPending) return
    if (warmSession) return
    if (warmInFlight.has(workspaceId)) return
    warmInFlight.add(workspaceId)
    void Result.tryPromise(() =>
      createSession.mutateAsync(NEW_SESSION_TITLE),
    ).then((result) => {
      warmInFlight.delete(workspaceId)
      if (Result.isError(result)) {
        console.warn('[chat.sessions] failed to warm idle session', result.error)
      }
    })
    // createSession intentionally excluded — its identity is stable per hook
    // instance and including it would re-run on every mutation state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, user?.id, sessionsQuery.isPending, warmSession?.id])

  // Claim the warm session (user is about to use it). Kicks off a background
  // replacement so we stay one ahead. Callers that open a chat panel should
  // prefer this over createSession.mutateAsync.
  const claimWarmSession = useCallback(async () => {
    if (warmSession) {
      // Replenish, but only if no other consumer has already started one.
      // Without this gate, multiple components reacting to the same claim
      // (e.g. sidebar click → opens panel → screen mounts) would each
      // spawn a replacement.
      if (workspaceId && !warmInFlight.has(workspaceId)) {
        warmInFlight.add(workspaceId)
        void Result.tryPromise(() =>
          createSession.mutateAsync(NEW_SESSION_TITLE),
        ).then((result) => {
          warmInFlight.delete(workspaceId)
          if (Result.isError(result)) {
            console.warn(
              '[chat.sessions] failed to replenish warm session',
              result.error,
            )
          }
        })
      }
      return warmSession
    }

    // No warm session available — create synchronously and skip replenish
    // (the useEffect above will spin one up once this lands in cache).
    return createSession.mutateAsync(NEW_SESSION_TITLE)
  }, [createSession, warmSession, workspaceId])

  return {
    agent: null,
    hostName: null,
    createSession,
    archiveSession,
    deleteSession,
    // Legacy aliases preserved for call sites that haven't migrated to
    // `claimWarmSession`. Both route to the warm-chat claim path.
    ensureIdleSession: claimWarmSession,
    getNextIdleSession: claimWarmSession,
    claimWarmSession,
    renameSession,
    reorderSessions,
    sessions,
    sessionsQuery,
    updateSessionPreview,
    warmSession,
  }
}
