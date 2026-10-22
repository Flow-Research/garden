import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { inboxKeys } from './queries'
import { useWorkspaceId } from '@garden/app-state/hooks'
import type { InboxItem } from '@garden/core/types'

export function useMarkInboxRead() {
  const qc = useQueryClient()
  const wsId = useWorkspaceId()
  const listKey = inboxKeys.list(wsId)
  return useMutation({
    mutationFn: (id: string) => api.markInboxRead(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: listKey })
      const prev = qc.getQueryData<InboxItem[]>(listKey)
      const target = prev?.find((item) => item.id === id)
      const issueId = target?.issue_id
      qc.setQueryData<InboxItem[]>(listKey, (old) =>
        old?.map((item) =>
          item.id === id || (issueId && item.issue_id === issueId)
            ? { ...item, read: true }
            : item,
        ),
      )
      return { prev }
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(listKey, ctx.prev)
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: listKey,
        exact: true,
      })
    },
  })
}

export function useArchiveInbox() {
  const qc = useQueryClient()
  const wsId = useWorkspaceId()
  const listKey = inboxKeys.list(wsId)
  return useMutation({
    mutationFn: (id: string) => api.archiveInbox(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: listKey })
      const prev = qc.getQueryData<InboxItem[]>(listKey)
      // The server applies the same issue-thread scope after resolving this id.
      const target = prev?.find((i) => i.id === id)
      const issueId = target?.issue_id
      qc.setQueryData<InboxItem[]>(listKey, (old) =>
        old?.map((item) =>
          item.id === id || (issueId && item.issue_id === issueId)
            ? { ...item, archived: true }
            : item,
        ),
      )
      return { prev }
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(listKey, ctx.prev)
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: listKey,
        exact: true,
      })
    },
  })
}

export function useMarkAllInboxRead() {
  const qc = useQueryClient()
  const wsId = useWorkspaceId()
  const listKey = inboxKeys.list(wsId)
  return useMutation({
    mutationFn: () => api.markAllInboxRead(),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: listKey })
      const prev = qc.getQueryData<InboxItem[]>(listKey)
      qc.setQueryData<InboxItem[]>(listKey, (old) =>
        old?.map((item) => (!item.archived ? { ...item, read: true } : item)),
      )
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(listKey, ctx.prev)
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

export function useArchiveAllInbox() {
  const qc = useQueryClient()
  const wsId = useWorkspaceId()
  return useMutation({
    mutationFn: () => api.archiveAllInbox(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: inboxKeys.list(wsId), exact: true })
    },
  })
}

export function useArchiveAllReadInbox() {
  const qc = useQueryClient()
  const wsId = useWorkspaceId()
  return useMutation({
    mutationFn: () => api.archiveAllReadInbox(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: inboxKeys.list(wsId), exact: true })
    },
  })
}

export function useArchiveCompletedInbox() {
  const qc = useQueryClient()
  const wsId = useWorkspaceId()
  return useMutation({
    mutationFn: () => api.archiveCompletedInbox(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: inboxKeys.list(wsId), exact: true })
    },
  })
}
