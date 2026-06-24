import { useLayoutEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useRequiredWorkspaceDock } from '@/components/shell/workspace-dock'
import { issueDetailOptions } from '@/lib/issues/queries'

const handledIssueDeepLinks = new Set<string>()

/** Strips only the `issue` deep-link param, leaving other workspace params intact. */
function removeIssueDeepLinkSearchParam() {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.searchParams.delete('issue')
  window.history.replaceState(window.history.state, '', url.toString())
}

/**
 * Opens the issue-detail panel when the workspace is loaded with an `?issue=<id>`
 * deep link — e.g. the "View task" button in an assignment email. Mirrors
 * ConnectorCallbackListener: this is one-shot external URL sync (fetch the issue
 * to warm its cache + get the tab title, open the panel, strip the param), not
 * tab-state projection, so a layout effect with a module-level dedupe Set is the
 * right tool rather than a render-time side effect. We fetch before opening so the
 * tab carries the real title (issue panels keep the title given at open time —
 * there is no rename hook) and the panel reads a warm cache instead of suspending.
 */
export function IssueDeepLinkListener({
  issueId,
  workspaceId,
}: {
  issueId?: string | null
  workspaceId: string
}) {
  const queryClient = useQueryClient()
  const dock = useRequiredWorkspaceDock()

  useLayoutEffect(() => {
    const id = issueId?.trim()
    if (!id) return

    const handledKey = `${workspaceId}:${id}`
    if (handledIssueDeepLinks.has(handledKey)) {
      removeIssueDeepLinkSearchParam()
      return
    }
    handledIssueDeepLinks.add(handledKey)
    removeIssueDeepLinkSearchParam()

    void queryClient.fetchQuery(issueDetailOptions(workspaceId, id)).then(
      (issue) => {
        dock.openPanel({
          kind: 'issue-detail',
          title: issue.title,
          entityId: id,
        })
      },
      () => {
        toast.error('Task unavailable', {
          description: 'It may have been deleted, or you do not have access.',
        })
      },
    )
  }, [issueId, workspaceId, queryClient, dock])

  return null
}
