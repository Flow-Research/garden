import { useMemo } from 'react'
import { useMutationState, useQuery } from '@tanstack/react-query'
import type { IssueReaction } from '@garden/core/types'
import { issueReactionsOptions } from '@/lib/issues/queries'
import {
  useToggleIssueReaction,
  type ToggleIssueReactionVars,
} from '@/lib/issues/mutations'

/** Applies pending toggles over server state without mutating the query cache. */
function projectPendingReactions(
  server: IssueReaction[],
  pending: Array<ToggleIssueReactionVars | undefined>,
  issueId: string,
  userId?: string,
): IssueReaction[] {
  return pending.reduce<IssueReaction[]>((current, operation) => {
    if (!operation) return current
    if (operation.existing) {
      return current.filter(
        (reaction) => reaction.id !== operation.existing?.id,
      )
    }
    const exists = current.some(
      (reaction) =>
        reaction.emoji === operation.emoji &&
        reaction.actor_type === 'member' &&
        reaction.actor_id === userId,
    )
    if (exists) return current
    return [
      ...current,
      {
        id: `optimistic-${operation.emoji}`,
        issue_id: issueId,
        actor_type: 'member',
        actor_id: userId ?? '',
        emoji: operation.emoji,
        created_at: '',
      },
    ]
  }, server)
}

/** Combines server reactions with pending mutation intent for instant feedback. */
export function useIssueReactions(issueId: string, userId?: string) {
  const { data: serverReactions = [], isLoading: loading } = useQuery(
    issueReactionsOptions(issueId),
  )
  const mutation = useToggleIssueReaction(issueId)
  const pending = useMutationState({
    filters: {
      mutationKey: ['toggleIssueReaction', issueId],
      status: 'pending',
    },
    select: (entry) =>
      entry.state.variables as ToggleIssueReactionVars | undefined,
  })
  const reactions = useMemo(
    () => projectPendingReactions(serverReactions, pending, issueId, userId),
    [serverReactions, pending, issueId, userId],
  )

  const toggleReaction = (emoji: string) => {
    if (!userId) return
    const existing = serverReactions.find(
      (reaction) =>
        reaction.emoji === emoji &&
        reaction.actor_type === 'member' &&
        reaction.actor_id === userId,
    )
    mutation.mutate({ emoji, existing })
  }

  return { reactions, loading, toggleReaction }
}
