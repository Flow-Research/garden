import { useCallback, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Result } from 'better-result'
import { toast } from 'sonner'
import {
  createChatThread,
  deleteChatThread,
  isPendingFirstTurn,
  listChatThreads,
  NEW_SESSION_TITLE,
  sortSessions,
  updateChatThread,
  type AgentChatSession,
} from '@/lib/api'
import { useAuthStore } from '@garden/app-state/auth'
import { useChatStore } from '@garden/app-state/chat'
import { useWorkspaceStore } from '@garden/app-state/workspace'

export type { AgentChatSession }
export { isPendingFirstTurn, NEW_SESSION_TITLE, sortSessions }

function isWarmSession(session: AgentChatSession) {
  return (
    !session.archivedAt &&
    session.status === 'idle' &&
    isPendingFirstTurn(session)
  )
}

export function useAgentSessions() {
  const qc = useQueryClient()
  const user = useAuthStore((state) => state.user)
  const workspace = useWorkspaceStore((state) => state.workspace)
  const selectedAgentId = useChatStore((state) => state.selectedAgentId)
  // Persisted bookkeeping: ids whose first turn errored. We exclude these
  // from the warm pool so a refetch can never re-promote a broken thread to
  // "next New Chat" status (the cache `status: 'error'` flag is transient and
  // gets wiped by refetch — this set survives).
  const erroredSessionIds = useChatStore((state) => state.erroredSessionIds)
  const workspaceId = workspace?.id ?? null

  const queryKey = useMemo(
    () => ['chat-threads', workspaceId, user?.id ?? null] as const,
    [workspaceId, user?.id],
  )

  const sessionsQuery = useQuery({
    queryKey,
    enabled: !!workspaceId && !!user?.id,
    queryFn: () => listChatThreads(workspaceId as string),
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
      return createChatThread({
        workspaceId,
        title,
        agentId: selectedAgentId,
        excludeThreadIds: Object.keys(erroredSessionIds),
      })
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

  // Optimistic remove + draft cleanup, with snapshot for rollback. Used by
  // both archive and delete since their on-success effect on the list is
  // identical: the row is gone, and any stashed composer draft for that
  // session is no longer reachable so we drop it from the persisted store
  // (otherwise it leaks into garden_chat_drafts forever). Same reasoning
  // for the errored-session bookkeeping — once the row is gone, leaving the
  // id in `erroredSessionIds` would be persistent dead weight.
  const optimisticRemoveSession = (sessionId: string) => {
    const previousSessions = qc.getQueryData<AgentChatSession[]>(queryKey)
    const previousDraft = useChatStore.getState().inputDrafts[sessionId] ?? null
    const previouslyErrored =
      sessionId in useChatStore.getState().erroredSessionIds

    qc.setQueryData<AgentChatSession[]>(queryKey, (current = []) =>
      current.filter((session) => session.id !== sessionId),
    )
    useChatStore.getState().clearInputDraft(sessionId)
    useChatStore.getState().setSessionErrored(sessionId, false)

    return {
      previousSessions,
      previousDraft,
      previouslyErrored,
      sessionId,
    }
  }

  const rollbackRemoveSession = (
    context:
      | {
          previousSessions: AgentChatSession[] | undefined
          previousDraft: string | null
          previouslyErrored: boolean
          sessionId: string
        }
      | undefined,
  ) => {
    if (!context) return
    if (context.previousSessions) {
      qc.setQueryData(queryKey, context.previousSessions)
    }
    if (context.previousDraft !== null) {
      useChatStore
        .getState()
        .setInputDraft(context.sessionId, context.previousDraft)
    }
    if (context.previouslyErrored) {
      useChatStore.getState().setSessionErrored(context.sessionId, true)
    }
  }

  const deleteSession = useMutation({
    mutationFn: async (sessionId: string) => {
      await deleteChatThread(sessionId)
      return sessionId
    },
    onMutate: async (sessionId) => optimisticRemoveSession(sessionId),
    onError: (_err, _sessionId, context) => {
      rollbackRemoveSession(context)
      toast.error('Failed to delete chat')
    },
  })

  const archiveSession = useMutation({
    mutationFn: async (sessionId: string) =>
      updateChatThread(sessionId, {
        archivedAt: new Date().toISOString(),
      }),
    onMutate: async (sessionId) => optimisticRemoveSession(sessionId),
    onError: (_err, _sessionId, context) => {
      rollbackRemoveSession(context)
      toast.error('Failed to archive chat')
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
                  ...(input.unread !== undefined
                    ? { unread: input.unread }
                    : {}),
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
          console.warn(
            '[chat.sessions] failed to persist preview',
            result.error,
          )
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

  // Keep exactly one warm empty chat per workspace/agent. Used only for the
  // snappy first click path; non-empty chats are never recycled. Errored ids
  // are excluded so a thread whose first turn failed can never be re-served
  // as the next "New Chat" — even after a refetch resets cache status to
  // 'idle' and the row would otherwise look pristine again.
  const warmSession = useMemo(
    () =>
      sessions.find(
        (session) =>
          isWarmSession(session) &&
          !(session.id in erroredSessionIds) &&
          (!selectedAgentId || session.agentId === selectedAgentId),
      ) ?? null,
    [erroredSessionIds, selectedAgentId, sessions],
  )

  const claimWarmSession = useCallback(async () => {
    if (warmSession) return warmSession
    return createSession.mutateAsync(NEW_SESSION_TITLE)
  }, [createSession, warmSession])

  return {
    createSession,
    archiveSession,
    deleteSession,
    claimWarmSession,
    renameSession,
    reorderSessions,
    sessions,
    sessionsQuery,
    updateSessionPreview,
    warmSession,
  }
}
