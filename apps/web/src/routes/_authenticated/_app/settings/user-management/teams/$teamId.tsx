import { createFileRoute } from '@tanstack/react-router'
import { UserManagementTeamDetail } from '@/features/settings/components/user-management-tab'
import { TeamRouteError } from '@/features/teams/components/team-route-error'
import {
  teamDetailOptions,
  teamIssueListOptions,
  teamMemberListOptions,
} from '@/features/teams/queries'
import { prefetchActiveWorkspace } from '@/lib/navigation/prefetch'
import { memberListOptions } from '@/lib/workspace/queries'

export const Route = createFileRoute(
  '/_authenticated/_app/settings/user-management/teams/$teamId',
)({
  loader: ({ context, params }) =>
    prefetchActiveWorkspace(context.queryClient, (workspaceId) => [
      memberListOptions(workspaceId),
      teamDetailOptions(workspaceId, params.teamId),
      teamMemberListOptions(workspaceId, params.teamId),
      teamIssueListOptions(workspaceId, params.teamId),
    ]),
  component: TeamDetailRoute,
  errorComponent: TeamRouteError,
})

function TeamDetailRoute() {
  const { teamId } = Route.useParams()
  return <UserManagementTeamDetail teamId={teamId} />
}
