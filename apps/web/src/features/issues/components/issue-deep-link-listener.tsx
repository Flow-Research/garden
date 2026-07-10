import { useLayoutEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useRequiredWorkspaceDock } from '@/components/shell/workspace-dock'
import { issueDetailOptions } from '@/lib/issues/queries'
import { useNavigation } from '@/features/navigation'

const handledIssueDeepLinks = new Set<string>()

/** Builds the route replacement used after consuming a one-shot issue link. */
export function withoutIssueDeepLink(
  pathname: string,
  searchParams: URLSearchParams,
) {
  const nextSearch = new URLSearchParams(searchParams)
  nextSearch.delete('issue')
  const serializedSearch = nextSearch.toString()
  return `${pathname}${serializedSearch ? `?${serializedSearch}` : ''}`
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
  const { pathname, searchParams, replace } = useNavigation()

  useLayoutEffect(() => {
    const id = issueId?.trim()
    if (!id) return

    const handledKey = `${workspaceId}:${id}`
    if (handledIssueDeepLinks.has(handledKey)) {
      replace(withoutIssueDeepLink(pathname, searchParams))
      return
    }
    handledIssueDeepLinks.add(handledKey)
    replace(withoutIssueDeepLink(pathname, searchParams))

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
  }, [issueId, workspaceId, queryClient, dock, pathname, searchParams, replace])

  return null
}
