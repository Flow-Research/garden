import { createFileRoute } from '@tanstack/react-router'
import { UserManagementTeamDetail } from '@/features/settings/components/user-management-tab'
import { validateTeamSearch } from '@/features/teams/components/team-detail'
import { TeamRouteError } from '@/features/teams/components/team-route-error'
import {
  teamDetailOptions,
  teamIssueListOptions,
  teamMemberListOptions,
  teamRepositoryListOptions,
} from '@/features/teams/queries'
import { prefetchActiveWorkspace } from '@/lib/navigation/prefetch'
import { memberListOptions } from '@/lib/workspace/queries'

export const Route = createFileRoute(
  '/_authenticated/_app/settings/user-management/teams/$teamId',
)({
  validateSearch: validateTeamSearch,
  loader: ({ context, params }) =>
    prefetchActiveWorkspace(context.queryClient, (workspaceId) => [
      memberListOptions(workspaceId),
      teamDetailOptions(workspaceId, params.teamId),
      teamMemberListOptions(workspaceId, params.teamId),
      teamIssueListOptions(workspaceId, params.teamId),
      teamRepositoryListOptions(workspaceId, params.teamId),
    ]),
  component: TeamDetailRoute,
  errorComponent: TeamRouteError,
})

function TeamDetailRoute() {
  const { teamId } = Route.useParams()
  const { tab } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <UserManagementTeamDetail
      teamId={teamId}
      tab={tab ?? 'members'}
      onTabChange={(next) => {
        void navigate({ search: { tab: next }, replace: true })
      }}
    />
  )
}
