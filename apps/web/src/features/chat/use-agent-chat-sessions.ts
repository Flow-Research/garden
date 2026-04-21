'use client'

import { useCallback, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@garden/core/auth'
import { useWorkspaceStore } from '@garden/core/workspace'

export interface AgentChatSession {
  id: string
  workspaceId: string
  ownerUserId: string
  title: string
  agentName: string
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

async function fetchChatThreads(workspaceId: string) {
  const url = new URL('/api/chat/threads', window.location.origin)
  url.searchParams.set('workspace_id', workspaceId)

  const response = await fetch(url.toString(), {
    credentials: 'include',
  })

  if (!response.ok) {
    throw new Error('Failed to load chat threads')
  }

  const rows = (await response.json()) as Array<{
    id: string
    workspaceId: string
    ownerUserId: string
    title: string
    agentName: string
    createdAt: string
    updatedAt: string
    lastMessage: string
    archivedAt: string | null
  }>

  return sortSessions(
    rows
      .filter((row) => !row.archivedAt)
      .map((row) => ({
        ...row,
        status: 'idle' as const,
        unread: false,
      })),
  )
}

async function createChatThread(workspaceId: string, title?: string) {
  const url = new URL('/api/chat/threads', window.location.origin)
  url.searchParams.set('workspace_id', workspaceId)

  const response = await fetch(url.toString(), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title }),
  })

  if (!response.ok) {
    throw new Error('Failed to create chat thread')
  }

  const row = (await response.json()) as {
    id: string
    workspaceId: string
    ownerUserId: string
    title: string
    agentName: string
    createdAt: string
    updatedAt: string
    lastMessage: string
    archivedAt: string | null
  }

  return {
    ...row,
    status: 'idle' as const,
    unread: false,
  } satisfies AgentChatSession
}

async function updateChatThread(
  threadId: string,
  body: Record<string, unknown>,
) {
  const response = await fetch(`/api/chat/threads/${threadId}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error('Failed to update chat thread')
  }

  const row = (await response.json()) as {
    id: string
    workspaceId: string
    ownerUserId: string
    title: string
    agentName: string
    createdAt: string
    updatedAt: string
    lastMessage: string
    archivedAt: string | null
  }

  return {
    ...row,
    status: row.archivedAt ? ('archived' as const) : ('idle' as const),
    unread: false,
  } satisfies AgentChatSession
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

  const updateSessionPreview = (input: {
    sessionId: string
    title?: string
    lastMessage?: string
    status?: AgentChatSession['status']
    unread?: boolean
    updatedAt?: string
  }) => {
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
                updatedAt: input.updatedAt ?? new Date().toISOString(),
              }
            : session,
        ),
      ),
    )

    void updateChatThread(input.sessionId, {
      ...(input.title ? { title: input.title } : {}),
      ...(input.lastMessage !== undefined
        ? { lastMessage: input.lastMessage }
        : {}),
      updatedAt: input.updatedAt ?? new Date().toISOString(),
    })
  }

  const reorderSessions = (orderedIds: string[]) => {
    qc.setQueryData<AgentChatSession[]>(queryKey, (current = []) => {
      const byId = new Map(current.map((session) => [session.id, session]))
      const ordered = orderedIds.flatMap((id) => {
        const session = byId.get(id)
        return session ? [session] : []
      })
      const remainder = current.filter((session) => !orderedIds.includes(session.id))
      return [...ordered, ...remainder]
    })
  }

  const ensureIdleSession = useCallback(async () => {
    return createSession.mutateAsync(NEW_SESSION_TITLE)
  }, [createSession])

  const getNextIdleSession = useCallback(async () => {
    return createSession.mutateAsync(NEW_SESSION_TITLE)
  }, [createSession])

  return {
    agent: null,
    agentName: null,
    createSession,
    archiveSession,
    deleteSession,
    ensureIdleSession,
    getNextIdleSession,
    renameSession,
    reorderSessions,
    sessions: sessionsQuery.data ?? [],
    sessionsQuery,
    updateSessionPreview,
  }
}
