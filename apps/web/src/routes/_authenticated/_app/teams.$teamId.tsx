import { Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  TeamDetail,
  type TeamTab,
} from '@/features/teams/components/team-detail'
import {
  teamDetailOptions,
  teamIssueListOptions,
  teamMemberListOptions,
} from '@/features/teams/queries'
import { prefetchActiveWorkspace } from '@/lib/navigation/prefetch'

export const Route = createFileRoute('/_authenticated/_app/teams/$teamId')({
  validateSearch: (search) => {
    const out: { tab?: TeamTab } = {}
    if (
      search.tab === 'members' ||
      search.tab === 'issues' ||
      search.tab === 'tasks'
    ) {
      out.tab = search.tab
    }
    return out
  },
  loader: ({ context, params }) =>
    prefetchActiveWorkspace(context.queryClient, (workspaceId) => [
      teamDetailOptions(workspaceId, params.teamId),
      teamMemberListOptions(workspaceId, params.teamId),
      teamIssueListOptions(workspaceId, params.teamId),
    ]),
  component: TeamDetailRoute,
})

function TeamDetailRoute() {
  const { teamId } = Route.useParams()
  const { tab } = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <Suspense
      fallback={<div className="flex-1 p-6 text-sm text-text-secondary">Loading Team…</div>}
    >
      <TeamDetail
        teamId={teamId}
        tab={tab ?? 'members'}
        onTabChange={(next) => {
          void navigate({ search: { tab: next }, replace: true })
        }}
      />
    </Suspense>
  )
}
