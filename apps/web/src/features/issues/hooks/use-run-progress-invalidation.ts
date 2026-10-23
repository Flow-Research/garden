import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { inboxKeys } from '@/lib/inbox/queries'
import { issueKeys } from '@/lib/issues/queries'

/**
 * Refreshes what an agent run changes, as the polled active-run data moves.
 *
 * This used to invalidate six query families, including the whole issue list
 * and the inbox, whenever the polled run object changed identity, which is
 * every 2 s poll while usage ticks, and on every mount. With an issue open
 * during a run, the board and inbox refetched continuously.
 *
 * Now, nothing happens on mount (the data was just fetched). A new event can
 * add run events to the timeline or create work products, so it refreshes
 * those two. A status transition (or a new run) can change the issue itself,
 * its pending approval and the inbox, so only then are those refreshed.
 */
export function useRunProgressInvalidation({
  issueId,
  workspaceId,
  runId,
  status,
  latestSeq,
}: {
  issueId: string
  workspaceId: string
  runId: string | null
  status: string
  latestSeq: number
}) {
  const queryClient = useQueryClient()
  const seen = useRef({ runId, status, latestSeq })

  useEffect(() => {
    const previous = seen.current
    const statusChanged = previous.runId !== runId || previous.status !== status
    const newEvents = previous.latestSeq !== latestSeq
    if (!statusChanged && !newEvents) return
    seen.current = { runId, status, latestSeq }

    const refresh = (queryKey: readonly unknown[]) =>
      void queryClient.invalidateQueries({ queryKey, exact: true })

    refresh(issueKeys.timeline(issueId))
    refresh(issueKeys.workProducts(issueId))
    if (!statusChanged) return
    refresh(issueKeys.detail(workspaceId, issueId))
    refresh(issueKeys.pendingApproval(issueId))
    refresh(issueKeys.list(workspaceId))
    refresh(inboxKeys.list(workspaceId))
  }, [issueId, latestSeq, queryClient, runId, status, workspaceId])
}
