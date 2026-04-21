'use client'

import { useCallback, useMemo } from 'react'
import { useAgent } from 'agents/react'
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useAuthStore } from '@garden/core/auth'
import { useWorkspaceStore } from '@garden/core/workspace'

export interface AgentChatSession {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  lastMessage: string
  status: 'idle' | 'submitted' | 'streaming' | 'error' | 'archived'
  unread: boolean
  archivedAt: string | null
}

export const NEW_SESSION_TITLE = 'New Chat'

const pendingIdleSessionCreations = new Map<string, Promise<AgentChatSession>>()

function sortSessions(sessions: AgentChatSession[]) {
  return [...sessions].sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
  )
}

function isIdleSession(session: AgentChatSession) {
  return (
    session.title.trim().toLowerCase() === NEW_SESSION_TITLE.toLowerCase() &&
    session.lastMessage.trim().length === 0 &&
    session.status === 'idle' &&
    !session.archivedAt
  )
}

export function useAgentSessions() {
  const qc = useQueryClient()
  const user = useAuthStore((state) => state.user)
  const workspace = useWorkspaceStore((state) => state.workspace)

  const agentName = useMemo(() => {
    if (!user?.id || !workspace?.id) return null
    return `${workspace.id}:${user.id}`
  }, [user?.id, workspace?.id])

  const agent = useAgent(
    agentName
      ? {
          agent: 'PrimaryAgent',
          name: agentName,
        }
      : { agent: 'PrimaryAgent', name: 'anonymous' },
  )

  const queryKey = useMemo(
    () => ['agent-sessions', agentName] as const,
    [agentName],
  )

  const sessionsQuery = useQuery({
    queryKey,
    enabled: !!agentName,
    queryFn: async () => {
      const rows = (await agent.stub.listSessions?.()) as
        | Array<{
            id: string
            title: string
            createdAt: string
            updatedAt: string
            lastMessage?: string
          }>
        | undefined
      return sortSessions(
        (rows ?? []).map((row) => ({
          ...row,
          lastMessage: row.lastMessage ?? '',
          status: 'idle' as const,
          unread: false,
          archivedAt: null,
        })),
      )
    },
    staleTime: 10_000,
  })

  const createSession = useMutation({
    mutationFn: async (title?: string) => {
      const created = (await agent.stub.createSession?.(
        title,
      )) as
        | {
            id: string
            title: string
            createdAt: string
            updatedAt: string
            lastMessage?: string
          }
        | undefined
      if (!created) {
        throw new Error('Failed to create session')
      }
      return {
        ...created,
        lastMessage: created.lastMessage ?? '',
        status: 'idle' as const,
        unread: false,
        archivedAt: null,
      } satisfies AgentChatSession
    },
    onSuccess: (created) => {
      qc.setQueryData<AgentChatSession[]>(queryKey, (current = []) =>
        sortSessions([created, ...current.filter((session) => session.id !== created.id)]),
      )
    },
  })

  const renameSession = useMutation({
    mutationFn: async (input: { sessionId: string; title: string }) => {
      await agent.stub.renameSession?.(input.sessionId, input.title)
      return input
    },
    onMutate: async ({ sessionId, title }) => {
      qc.setQueryData<AgentChatSession[]>(queryKey, (current = []) =>
        current.map((session) =>
          session.id === sessionId
            ? { ...session, title, updatedAt: new Date().toISOString() }
            : session,
        ),
      )
    },
  })

  const deleteSession = useMutation({
    mutationFn: async (sessionId: string) => {
      await agent.stub.deleteSession?.(sessionId)
      return sessionId
    },
    onMutate: async (sessionId) => {
      qc.setQueryData<AgentChatSession[]>(queryKey, (current = []) =>
        current.filter((session) => session.id !== sessionId),
      )
    },
  })

  const archiveSession = useMutation({
    mutationFn: async (sessionId: string) => {
      await agent.stub.archiveSession?.(sessionId)
      return {
        archivedAt: new Date().toISOString(),
        sessionId,
      }
    },
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
    if (!agentName) {
      throw new Error('Missing agent identity')
    }

    const currentSessions =
      qc.getQueryData<AgentChatSession[]>(queryKey) ?? sessionsQuery.data ?? []
    const existingIdle = currentSessions.find(isIdleSession)
    if (existingIdle) {
      return existingIdle
    }

    const pending = pendingIdleSessionCreations.get(agentName)
    if (pending) {
      return pending
    }

    const creation = createSession.mutateAsync(NEW_SESSION_TITLE)
    pendingIdleSessionCreations.set(agentName, creation)

    return creation.finally(() => {
      pendingIdleSessionCreations.delete(agentName)
    })
  }, [agentName, createSession, qc, queryKey, sessionsQuery.data])

  const getNextIdleSession = useCallback(async (activeSessionId?: string | null) => {
    const currentSessions =
      qc.getQueryData<AgentChatSession[]>(queryKey) ?? sessionsQuery.data ?? []
    const otherIdle =
      currentSessions.find(
        (session) => isIdleSession(session) && session.id !== activeSessionId,
      ) ?? currentSessions.find(isIdleSession)

    if (otherIdle) {
      return otherIdle
    }

    return ensureIdleSession()
  }, [ensureIdleSession, qc, queryKey, sessionsQuery.data])

  return {
    agent,
    agentName,
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
