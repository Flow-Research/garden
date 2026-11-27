import { useState, useCallback, useMemo } from 'react'
import { useQuery, useMutationState } from '@tanstack/react-query'
import type { Reaction, TimelineEntry } from '@garden/core/types'
import { issueTimelineOptions } from '@/lib/issues/queries'
import {
  useCreateComment,
  useUpdateComment,
  useDeleteComment,
  useToggleCommentReaction,
  type ToggleCommentReactionVars,
} from '@/lib/issues/mutations'
import { toast } from 'sonner'

const NO_ENTRIES: TimelineEntry[] = []

export function useIssueTimeline(issueId: string, userId?: string) {
  const timelineQuery = useQuery(issueTimelineOptions(issueId))
  const timeline = timelineQuery.data ?? NO_ENTRIES
  const loading = timelineQuery.isLoading
  // Only a failed first load replaces the timeline; a failed refetch keeps
  // the entries already shown.
  const loadFailed = timelineQuery.isError && timelineQuery.data === undefined
  const { refetch } = timelineQuery
  const retryLoad = useCallback(() => void refetch(), [refetch])
  const [submitting, setSubmitting] = useState(false)

  const createCommentMutation = useCreateComment(issueId)
  const updateCommentMutation = useUpdateComment(issueId)
  const deleteCommentMutation = useDeleteComment(issueId)
  const toggleReactionMutation = useToggleCommentReaction(issueId)

  // --- Mutation functions ---
  // Each resolves to true once the server accepted the change, so callers
  // clear the editor (or leave edit mode) only then. On failure the error is
  // toasted here and the user's text stays where it is.

  const submitComment = useCallback(
    async (content: string, attachmentIds?: string[]): Promise<boolean> => {
      if (!content.trim() || submitting || !userId) return false
      setSubmitting(true)
      try {
        await createCommentMutation.mutateAsync({
          content,
          attachmentIds,
        })
        return true
      } catch {
        toast.error('Failed to send comment')
        return false
      } finally {
        setSubmitting(false)
      }
    },
    [userId, submitting, createCommentMutation],
  )

  const submitReply = useCallback(
    async (
      parentId: string,
      content: string,
      attachmentIds?: string[],
    ): Promise<boolean> => {
      if (!content.trim() || !userId) return false
      try {
        await createCommentMutation.mutateAsync({
          content,
          type: 'comment',
          parentId,
          attachmentIds,
        })
        return true
      } catch {
        toast.error('Failed to send reply')
        return false
      }
    },
    [userId, createCommentMutation],
  )

  const editComment = useCallback(
    async (commentId: string, content: string): Promise<boolean> => {
      try {
        await updateCommentMutation.mutateAsync({ commentId, content })
        return true
      } catch {
        toast.error('Failed to update comment')
        return false
      }
    },
    [updateCommentMutation],
  )

  const deleteComment = useCallback(
    async (commentId: string): Promise<boolean> => {
      try {
        await deleteCommentMutation.mutateAsync(commentId)
        return true
      } catch {
        toast.error('Failed to delete comment')
        return false
      }
    },
    [deleteCommentMutation],
  )

  // --- Optimistic UI derivation for comment reactions ---
  // Instead of writing temp data into the cache (which races with WS events),
  // derive optimistic state at render time from pending mutation variables.

  const pendingReactionVars = useMutationState({
    filters: {
      mutationKey: ['toggleCommentReaction', issueId],
      status: 'pending',
    },
    select: (m) => m.state.variables as ToggleCommentReactionVars | undefined,
  })

  const optimisticTimeline = useMemo(() => {
    if (pendingReactionVars.length === 0) return timeline

    return timeline.map((entry) => {
      const pendingForEntry = pendingReactionVars.filter(
        (v) => v && v.commentId === entry.id,
      )
      if (pendingForEntry.length === 0) return entry

      let reactions = entry.reactions ?? []
      for (const vars of pendingForEntry) {
        if (!vars) continue
        if (vars.existing) {
          // Pending removal
          reactions = reactions.filter((r) => r.id !== vars.existing!.id)
        } else {
          // Pending add — skip if server already has it (WS arrived first)
          const alreadyExists = reactions.some(
            (r) =>
              r.emoji === vars.emoji &&
              r.actor_type === 'member' &&
              r.actor_id === userId,
          )
          if (!alreadyExists) {
            reactions = [
              ...reactions,
              {
                id: `optimistic-${vars.emoji}`,
                comment_id: vars.commentId,
                actor_type: 'member',
                actor_id: userId ?? '',
                emoji: vars.emoji,
                created_at: '',
              },
            ]
          }
        }
      }
      return { ...entry, reactions }
    })
  }, [timeline, pendingReactionVars, userId])

  const toggleReaction = useCallback(
    async (commentId: string, emoji: string) => {
      if (!userId) return
      // Read from server timeline (not optimistic) to find the real reaction
      const entry = timeline.find((e) => e.id === commentId)
      const existing: Reaction | undefined = (entry?.reactions ?? []).find(
        (r) =>
          r.emoji === emoji &&
          r.actor_type === 'member' &&
          r.actor_id === userId,
      )
      toggleReactionMutation.mutate({ commentId, emoji, existing })
    },
    [userId, timeline, toggleReactionMutation],
  )

  return {
    timeline: optimisticTimeline,
    loading,
    loadFailed,
    retrying: timelineQuery.isFetching,
    retryLoad,
    submitting,
    submitComment,
    submitReply,
    editComment,
    deleteComment,
    toggleReaction,
  }
}
