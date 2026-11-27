import { createFileRoute } from '@tanstack/react-router'
import { useSurfaceTabsStore } from '@garden/app-state/surface-tabs'
import { IssueDetail } from '@/features/issues/components'

export const Route = createFileRoute('/_authenticated/_app/tasks/$issueId')({
  // Client-only tab bookkeeping on direct loads. Runs outside React render
  // (loaders are the router's data boundary), keeping the no-useEffect rule
  // intact; skipped on the server where the workspace store is empty. The
  // strip (in the parent layout) upgrades the raw id to the real title via
  // the live query cache.
  validateSearch: (search) => {
    const out: { workspace_id?: string; focus?: string } = {}
    if (typeof search.workspace_id === 'string')
      out.workspace_id = search.workspace_id
    // IssueDetail reads the inbox focus target (comment:<id>, run:<id>, …)
    // from the URL — admit it or validateSearch strips it.
    if (typeof search.focus === 'string') out.focus = search.focus
    return out
  },
  loader: ({ params }) => {
    if (typeof window === 'undefined') return
    // Absent-only: re-upserting would downgrade a real title to the raw id.
    const { bySurface, upsertTab } = useSurfaceTabsStore.getState()
    const tabs = bySurface['tasks'] ?? []
    if (tabs.some((tab) => tab.id === params.issueId)) return
    upsertTab('tasks', { id: params.issueId, title: params.issueId })
  },
  component: TaskDetailRoute,
})

function TaskDetailRoute() {
  const { issueId } = Route.useParams()
  return <IssueDetail issueId={issueId} />
}
