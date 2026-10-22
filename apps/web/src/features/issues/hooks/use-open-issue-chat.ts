import { useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Issue } from '@garden/core/types'
import { api, sortSessions, type AgentChatSession } from '@/lib/api'
import { chatThreadKeys } from '@/features/chat/queries'
import { useSurfaceNavigation } from '@/features/navigation/use-surface-navigation'

/**
 * "Open in chat" for an agent-assigned issue. Optimistically inserts the
 * issue's chat thread into the thread list and opens it, then swaps in the
 * server's thread (or rolls back and toasts on failure).
 */
export function useOpenIssueChat({
  issueId,
  issue,
  userId,
}: {
  issueId: string
  issue: Issue | null | undefined
  userId: string | undefined
}) {
  const queryClient = useQueryClient()
  const { openChatSession } = useSurfaceNavigation()

  const mutation = useMutation({
    mutationFn: async (input: {
      agentId: string
      optimisticThreadId: string
      workspaceId: string
    }) =>
      api.openChatForIssue({
        workspaceId: input.workspaceId,
        issueId,
        issueTitle: issue?.title ?? 'Issue chat',
        agentId: input.agentId,
        threadId: input.optimisticThreadId,
      }),
    onMutate: async (input) => {
      if (!issue || !userId) return null

      const queryKey = chatThreadKeys.list(input.workspaceId, userId)
      const previousSessions =
        queryClient.getQueryData<AgentChatSession[]>(queryKey)

      const now = new Date().toISOString()
      const optimisticSession: AgentChatSession = {
        id: input.optimisticThreadId,
        workspaceId: input.workspaceId,
        ownerUserId: userId,
        title: issue.title,
        agentId: input.agentId,
        hostName: input.agentId,
        primary_issue_id: issue.id,
        runtime_kind: 'issue_run',
        runtime_key: issue.id,
        primaryIssue: {
          id: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          status: issue.status,
        },
        createdAt: now,
        updatedAt: now,
        lastMessage: '',
        archivedAt: null,
        status: 'idle',
        unread: false,
        optimistic: true,
      }

      queryClient.setQueryData<AgentChatSession[]>(queryKey, (current = []) =>
        sortSessions([
          optimisticSession,
          ...current.filter((session) => session.id !== optimisticSession.id),
        ]),
      )

      openChatSession({
        id: optimisticSession.id,
        title: optimisticSession.title,
      })

      return {
        optimisticThreadId: optimisticSession.id,
        previousSessions,
        queryKey,
      }
    },
    onSuccess: (session, _input, context) => {
      if (context) {
        queryClient.setQueryData<AgentChatSession[]>(
          context.queryKey,
          (current = []) =>
            sortSessions([
              session,
              ...current.filter(
                (item) =>
                  item.id !== context.optimisticThreadId &&
                  item.id !== session.id,
              ),
            ]),
        )
      }

      openChatSession({
        id: session.id,
        title: session.title,
      })
    },
    onError: (err, _input, context) => {
      if (context) {
        queryClient.setQueryData(context.queryKey, context.previousSessions)
      }
      toast.error(err instanceof Error ? err.message : 'Failed to open chat')
    },
  })

  const openChat = useCallback(() => {
    if (!issue) return
    if (issue.assignee_type !== 'agent' || !issue.assignee_id) {
      toast.error('Open chat is only available for agent-assigned issues')
      return
    }

    if (!userId) return

    mutation.mutate({
      agentId: issue.assignee_id,
      optimisticThreadId: issue.id,
      workspaceId: issue.workspace_id,
    })
  }, [issue, mutation, userId])

  return { openChat, isPending: mutation.isPending }
}
