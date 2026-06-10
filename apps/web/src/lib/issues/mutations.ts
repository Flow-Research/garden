import { useState, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Result } from 'better-result'
import { api } from '@/lib/api'
import { issueKeys, CLOSED_PAGE_SIZE } from './queries'
import { useWorkspaceId } from '@garden/app-state/hooks'
import type { Issue, IssueReaction } from '@garden/core/types'
import type {
  CreateIssueRequest,
  UpdateIssueRequest,
  ListIssuesResponse,
} from '@garden/core/types'
import type {
  TimelineEntry,
  IssueSubscriber,
  Reaction,
} from '@garden/core/types'

// ---------------------------------------------------------------------------
// Shared mutation variable types — used by both mutation hooks and
// useMutationState consumers to keep the type assertion in sync.
// ---------------------------------------------------------------------------

export type ToggleCommentReactionVars = {
  commentId: string
  emoji: string
  existing: Reaction | undefined
}

export type ToggleIssueReactionVars = {
  emoji: string
  existing: IssueReaction | undefined
}

// ---------------------------------------------------------------------------
// Done issue pagination
// ---------------------------------------------------------------------------

export function useLoadMoreDoneIssues() {
  const qc = useQueryClient()
  const wsId = useWorkspaceId()
  const [isLoading, setIsLoading] = useState(false)

  const queryKey = issueKeys.list(wsId)
  const cache = qc.getQueryData<ListIssuesResponse>(queryKey)
  const doneLoaded = cache
    ? cache.issues.filter((i) => i.status === 'done').length
    : 0
  const doneTotal = cache?.doneTotal ?? 0
  const hasMore = doneLoaded < doneTotal

  const loadMore = useCallback(async () => {
    if (isLoading || !hasMore) return
    setIsLoading(true)
    const result = await Result.tryPromise(() =>
      api.listIssues({
        status: 'done',
        limit: CLOSED_PAGE_SIZE,
        offset: doneLoaded,
      }),
    )
    setIsLoading(false)
    if (Result.isError(result)) {
      throw result.error
    }

    const res = result.value
    qc.setQueryData<ListIssuesResponse>(queryKey, (old) => {
      if (!old) return old
      const existingIds = new Set(old.issues.map((i) => i.id))
      const newIssues = res.issues.filter((i) => !existingIds.has(i.id))
      return {
        ...old,
        issues: [...old.issues, ...newIssues],
        doneTotal: res.total,
      }
    })
  }, [qc, queryKey, doneLoaded, hasMore, isLoading])

  return { loadMore, hasMore, isLoading, doneTotal }
}

// ---------------------------------------------------------------------------
// Issue CRUD
// ---------------------------------------------------------------------------

export function useCreateIssue() {
  const qc = useQueryClient()
  const wsId = useWorkspaceId()
  const listKey = issueKeys.list(wsId)
  return useMutation({
    mutationFn: (data: CreateIssueRequest) => api.createIssue(data),
    onSuccess: (newIssue) => {
      qc.setQueryData<ListIssuesResponse>(listKey, (old) =>
        old && !old.issues.some((i) => i.id === newIssue.id)
          ? {
              ...old,
              issues: [...old.issues, newIssue],
              total: old.total + 1,
              doneTotal:
                (old.doneTotal ?? 0) + (newIssue.status === 'done' ? 1 : 0),
            }
          : old,
      )
      qc.invalidateQueries({
        queryKey: listKey,
        exact: true,
        refetchType: 'none',
      })
      // Invalidate parent's children query so sub-issues list updates immediately
      if (newIssue.parent_issue_id) {
        qc.invalidateQueries({
          queryKey: issueKeys.children(wsId, newIssue.parent_issue_id),
          exact: true,
        })
        qc.invalidateQueries({
          queryKey: issueKeys.childProgress(wsId),
          exact: true,
        })
      }
    },
  })
}

export function useUpdateIssue() {
  const qc = useQueryClient()
  const wsId = useWorkspaceId()
  const listKey = issueKeys.list(wsId)
  return useMutation({
    mutationFn: async ({
      id,
      ...data
    }: { id: string } & UpdateIssueRequest) => {
      return api.updateIssue(id, data)
    },
    onMutate: ({ id, ...data }) => {
      // Fire-and-forget cancelQueries — keeps onMutate synchronous so the
      // cache update happens in the same tick as mutate(). Awaiting would
      // yield to the event loop, letting @dnd-kit reset its visual state
      // before the optimistic update lands.
      qc.cancelQueries({ queryKey: listKey })
      const prevList = qc.getQueryData<ListIssuesResponse>(listKey)
      const prevDetail = qc.getQueryData<Issue>(issueKeys.detail(wsId, id))

      // Resolve parent_issue_id from the freshest source so we can keep the
      // parent's children cache in sync (used by the parent issue's
      // sub-issues list).
      const parentId =
        prevDetail?.parent_issue_id ??
        prevList?.issues.find((i) => i.id === id)?.parent_issue_id ??
        null
      const prevChildren = parentId
        ? qc.getQueryData<Issue[]>(issueKeys.children(wsId, parentId))
        : undefined

      qc.setQueryData<ListIssuesResponse>(listKey, (old) =>
        old
          ? {
              ...old,
              issues: old.issues.map((i) =>
                i.id === id ? { ...i, ...data } : i,
              ),
            }
          : old,
      )
      qc.setQueryData<Issue>(issueKeys.detail(wsId, id), (old) =>
        old ? { ...old, ...data } : old,
      )
      if (parentId) {
        qc.setQueryData<Issue[]>(issueKeys.children(wsId, parentId), (old) =>
          old?.map((c) => (c.id === id ? { ...c, ...data } : c)),
        )
      }
      return { prevList, prevDetail, prevChildren, parentId, id }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prevList) qc.setQueryData(listKey, ctx.prevList)
      if (ctx?.prevDetail)
        qc.setQueryData(issueKeys.detail(wsId, ctx.id), ctx.prevDetail)
      if (ctx?.parentId && ctx.prevChildren !== undefined) {
        qc.setQueryData(
          issueKeys.children(wsId, ctx.parentId),
          ctx.prevChildren,
        )
      }
    },
    onSuccess: (updatedIssue, vars, ctx) => {
      qc.setQueryData<ListIssuesResponse>(listKey, (old) =>
        old
          ? {
              ...old,
              issues: old.issues.map((i) =>
                i.id === updatedIssue.id ? updatedIssue : i,
              ),
            }
          : old,
      )
      qc.setQueryData<Issue>(issueKeys.detail(wsId, vars.id), updatedIssue)
      if (ctx?.parentId) {
        qc.setQueryData<Issue[]>(
          issueKeys.children(wsId, ctx.parentId),
          (old) =>
            old?.map((child) =>
              child.id === updatedIssue.id ? updatedIssue : child,
            ),
        )
      }
      qc.invalidateQueries({
        queryKey: issueKeys.detail(wsId, vars.id),
        exact: true,
        refetchType: 'none',
      })
      qc.invalidateQueries({
        queryKey: listKey,
        exact: true,
        refetchType: 'none',
      })
      // Invalidate old parent's children cache
      if (ctx?.parentId) {
        qc.invalidateQueries({
          queryKey: issueKeys.children(wsId, ctx.parentId),
          exact: true,
        })
        qc.invalidateQueries({
          queryKey: issueKeys.childProgress(wsId),
          exact: true,
        })
      }
      // Invalidate new parent's children cache when parent_issue_id changed
      const newParentId = vars.parent_issue_id
      if (newParentId && newParentId !== ctx?.parentId) {
        qc.invalidateQueries({
          queryKey: issueKeys.children(wsId, newParentId),
          exact: true,
        })
        qc.invalidateQueries({
          queryKey: issueKeys.childProgress(wsId),
          exact: true,
        })
      }
    },
  })
}

export function useDeleteIssue() {
  const qc = useQueryClient()
  const wsId = useWorkspaceId()
  const listKey = issueKeys.list(wsId)
  return useMutation({
    mutationFn: (id: string) => api.deleteIssue(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: listKey })
      const prevList = qc.getQueryData<ListIssuesResponse>(listKey)
      const deleted = prevList?.issues.find((i) => i.id === id)
      qc.setQueryData<ListIssuesResponse>(listKey, (old) => {
        if (!old) return old
        const d = old.issues.find((i) => i.id === id)
        return {
          ...old,
          issues: old.issues.filter((i) => i.id !== id),
          total: old.total - 1,
          doneTotal: (old.doneTotal ?? 0) - (d?.status === 'done' ? 1 : 0),
        }
      })
      qc.removeQueries({ queryKey: issueKeys.detail(wsId, id) })
      return { prevList, parentIssueId: deleted?.parent_issue_id }
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prevList) qc.setQueryData(listKey, ctx.prevList)
    },
    onSuccess: (_data, _id, ctx) => {
      qc.invalidateQueries({
        queryKey: listKey,
        exact: true,
        refetchType: 'none',
      })
      if (ctx?.parentIssueId) {
        qc.invalidateQueries({
          queryKey: issueKeys.children(wsId, ctx.parentIssueId),
          exact: true,
        })
        qc.invalidateQueries({
          queryKey: issueKeys.childProgress(wsId),
          exact: true,
        })
      }
    },
  })
}

export function useBatchUpdateIssues() {
  const qc = useQueryClient()
  const wsId = useWorkspaceId()
  const listKey = issueKeys.list(wsId)
  return useMutation({
    mutationFn: ({
      ids,
      updates,
    }: {
      ids: string[]
      updates: UpdateIssueRequest
    }) => api.batchUpdateIssues(ids, updates),
    onMutate: async ({ ids, updates }) => {
      await qc.cancelQueries({ queryKey: listKey })
      const prevList = qc.getQueryData<ListIssuesResponse>(listKey)
      qc.setQueryData<ListIssuesResponse>(listKey, (old) =>
        old
          ? {
              ...old,
              issues: old.issues.map((i) =>
                ids.includes(i.id) ? { ...i, ...updates } : i,
              ),
            }
          : old,
      )
      return { prevList }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prevList) qc.setQueryData(listKey, ctx.prevList)
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: listKey,
        exact: true,
        refetchType: 'none',
      })
    },
  })
}

export function useBatchDeleteIssues() {
  const qc = useQueryClient()
  const wsId = useWorkspaceId()
  const listKey = issueKeys.list(wsId)
  return useMutation({
    mutationFn: (ids: string[]) => api.batchDeleteIssues(ids),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: listKey })
      const prevList = qc.getQueryData<ListIssuesResponse>(listKey)
      const idSet = new Set(ids)
      const parentIssueIds = new Set(
        prevList?.issues
          .filter((i) => idSet.has(i.id) && i.parent_issue_id)
          .map((i) => i.parent_issue_id!) ?? [],
      )
      qc.setQueryData<ListIssuesResponse>(listKey, (old) => {
        if (!old) return old
        const doneDeleted = old.issues.filter(
          (i) => idSet.has(i.id) && i.status === 'done',
        ).length
        return {
          ...old,
          issues: old.issues.filter((i) => !idSet.has(i.id)),
          total: old.total - ids.length,
          doneTotal: (old.doneTotal ?? 0) - doneDeleted,
        }
      })
      return { prevList, parentIssueIds }
    },
    onError: (_err, _ids, ctx) => {
      if (ctx?.prevList) qc.setQueryData(listKey, ctx.prevList)
    },
    onSuccess: (_data, _ids, ctx) => {
      qc.invalidateQueries({
        queryKey: listKey,
        exact: true,
        refetchType: 'none',
      })
      if (ctx?.parentIssueIds && ctx.parentIssueIds.size > 0) {
        for (const parentId of ctx.parentIssueIds) {
          qc.invalidateQueries({
            queryKey: issueKeys.children(wsId, parentId),
            exact: true,
          })
        }
        qc.invalidateQueries({
          queryKey: issueKeys.childProgress(wsId),
          exact: true,
        })
      }
    },
  })
}

// ---------------------------------------------------------------------------
// Comments / Timeline
// ---------------------------------------------------------------------------

export function useCreateComment(issueId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      content,
      type,
      parentId,
      attachmentIds,
    }: {
      content: string
      type?: string
      parentId?: string
      attachmentIds?: string[]
    }) => api.createComment(issueId, content, type, parentId, attachmentIds),
    onSuccess: (comment) => {
      qc.setQueryData<TimelineEntry[]>(issueKeys.timeline(issueId), (old) => {
        if (!old) return old
        const entry: TimelineEntry = {
          type: 'comment',
          id: comment.id,
          actor_type: comment.author_type,
          actor_id: comment.author_id,
          content: comment.content,
          parent_id: comment.parent_id,
          comment_type: comment.type,
          reactions: comment.reactions ?? [],
          attachments: comment.attachments ?? [],
          created_at: comment.created_at,
          updated_at: comment.updated_at,
        }
        if (old.some((e) => e.id === comment.id)) return old
        return [...old, entry]
      })
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: issueKeys.timeline(issueId) })
    },
  })
}

export function useUpdateComment(issueId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      commentId,
      content,
    }: {
      commentId: string
      content: string
    }) => api.updateComment(commentId, content),
    onMutate: async ({ commentId, content }) => {
      await qc.cancelQueries({ queryKey: issueKeys.timeline(issueId) })
      const prev = qc.getQueryData<TimelineEntry[]>(issueKeys.timeline(issueId))
      qc.setQueryData<TimelineEntry[]>(issueKeys.timeline(issueId), (old) =>
        old?.map((e) => (e.id === commentId ? { ...e, content } : e)),
      )
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(issueKeys.timeline(issueId), ctx.prev)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: issueKeys.timeline(issueId) })
    },
  })
}

export function useDeleteComment(issueId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (commentId: string) => api.deleteComment(commentId),
    onMutate: async (commentId) => {
      await qc.cancelQueries({ queryKey: issueKeys.timeline(issueId) })
      const prev = qc.getQueryData<TimelineEntry[]>(issueKeys.timeline(issueId))

      // Cascade: collect all child comment IDs
      const toRemove = new Set<string>([commentId])
      if (prev) {
        let changed = true
        while (changed) {
          changed = false
          for (const e of prev) {
            if (
              e.parent_id &&
              toRemove.has(e.parent_id) &&
              !toRemove.has(e.id)
            ) {
              toRemove.add(e.id)
              changed = true
            }
          }
        }
      }

      qc.setQueryData<TimelineEntry[]>(issueKeys.timeline(issueId), (old) =>
        old?.filter((e) => !toRemove.has(e.id)),
      )
      return { prev }
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(issueKeys.timeline(issueId), ctx.prev)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: issueKeys.timeline(issueId) })
    },
  })
}

export function useToggleCommentReaction(issueId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationKey: ['toggleCommentReaction', issueId] as const,
    mutationFn: async ({
      commentId,
      emoji,
      existing,
    }: ToggleCommentReactionVars) => {
      if (existing) {
        await api.removeReaction(commentId, emoji)
        return null
      }
      return api.addReaction(commentId, emoji)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: issueKeys.timeline(issueId) })
    },
  })
}

// ---------------------------------------------------------------------------
// Issue-level Reactions
// ---------------------------------------------------------------------------

export function useToggleIssueReaction(issueId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationKey: ['toggleIssueReaction', issueId] as const,
    mutationFn: async ({ emoji, existing }: ToggleIssueReactionVars) => {
      if (existing) {
        await api.removeIssueReaction(issueId, emoji)
        return null
      }
      return api.addIssueReaction(issueId, emoji)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: issueKeys.reactions(issueId) })
    },
  })
}

// ---------------------------------------------------------------------------
// Issue Subscribers
// ---------------------------------------------------------------------------

export function useToggleIssueSubscriber(issueId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      userId,
      userType,
      subscribed,
    }: {
      userId: string
      userType: 'member' | 'agent'
      subscribed: boolean
    }) => {
      if (subscribed) {
        await api.unsubscribeFromIssue(issueId, userId, userType)
      } else {
        await api.subscribeToIssue(issueId, userId, userType)
      }
    },
    onMutate: async ({ userId, userType, subscribed }) => {
      await qc.cancelQueries({ queryKey: issueKeys.subscribers(issueId) })
      const prev = qc.getQueryData<IssueSubscriber[]>(
        issueKeys.subscribers(issueId),
      )

      if (subscribed) {
        qc.setQueryData<IssueSubscriber[]>(
          issueKeys.subscribers(issueId),
          (old) =>
            old?.filter(
              (s) => !(s.user_id === userId && s.user_type === userType),
            ),
        )
      } else {
        const temp: IssueSubscriber = {
          issue_id: issueId,
          user_type: userType,
          user_id: userId,
          reason: 'manual',
          created_at: new Date().toISOString(),
        }
        qc.setQueryData<IssueSubscriber[]>(
          issueKeys.subscribers(issueId),
          (old) => {
            if (
              old?.some((s) => s.user_id === userId && s.user_type === userType)
            )
              return old
            return [...(old ?? []), temp]
          },
        )
      }
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(issueKeys.subscribers(issueId), ctx.prev)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: issueKeys.subscribers(issueId) })
    },
  })
}
