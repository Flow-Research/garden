import { useState, useCallback, useMemo } from 'react'
import { useQuery, useMutationState } from '@tanstack/react-query'
import type { Reaction } from '@garden/core/types'
import { issueTimelineOptions } from '@/lib/issues/queries'
import {
  useCreateComment,
  useUpdateComment,
  useDeleteComment,
  useToggleCommentReaction,
  type ToggleCommentReactionVars,
} from '@/lib/issues/mutations'
import { toast } from 'sonner'

export function useIssueTimeline(issueId: string, userId?: string) {
  const { data: timeline = [], isLoading: loading } = useQuery(
    issueTimelineOptions(issueId),
  )
  const [submitting, setSubmitting] = useState(false)

  const createCommentMutation = useCreateComment(issueId)
  const updateCommentMutation = useUpdateComment(issueId)
  const deleteCommentMutation = useDeleteComment(issueId)
  const toggleReactionMutation = useToggleCommentReaction(issueId)

  // --- Mutation functions ---

  const submitComment = useCallback(
    async (content: string, attachmentIds?: string[]) => {
      if (!content.trim() || submitting || !userId) return
      setSubmitting(true)
      try {
        await createCommentMutation.mutateAsync({
          content,
          attachmentIds,
        })
      } catch {
        toast.error('Failed to send comment')
      } finally {
        setSubmitting(false)
      }
    },
    [userId, submitting, createCommentMutation],
  )

  const submitReply = useCallback(
    async (parentId: string, content: string, attachmentIds?: string[]) => {
      if (!content.trim() || !userId) return
      try {
        await createCommentMutation.mutateAsync({
          content,
          type: 'comment',
          parentId,
          attachmentIds,
        })
      } catch {
        toast.error('Failed to send reply')
      }
    },
    [userId, createCommentMutation],
  )

  const editComment = useCallback(
    async (commentId: string, content: string) => {
      try {
        await updateCommentMutation.mutateAsync({ commentId, content })
      } catch {
        toast.error('Failed to update comment')
      }
    },
    [updateCommentMutation],
  )

  const deleteComment = useCallback(
    async (commentId: string) => {
      try {
        await deleteCommentMutation.mutateAsync(commentId)
      } catch {
        toast.error('Failed to delete comment')
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
    submitting,
    submitComment,
    submitReply,
    editComment,
    deleteComment,
    toggleReaction,
  }
}
