import { Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { TeamRouteError } from '@/features/teams/components/team-route-error'
import { TeamWorkPage } from '@/features/teams/components/team-work-page'
import {
  allTeamIssuesOptions,
  teamListOptions,
} from '@/features/teams/queries'
import { prefetchActiveWorkspace } from '@/lib/navigation/prefetch'

export const Route = createFileRoute('/_authenticated/_app/teams/issues')({
  loader: ({ context }) =>
    prefetchActiveWorkspace(context.queryClient, (workspaceId) => [
      allTeamIssuesOptions(workspaceId),
      teamListOptions(workspaceId),
    ]),
  component: TeamsIssuesRoute,
  errorComponent: TeamRouteError,
})

function TeamsIssuesRoute() {
  return (
    <Suspense
      fallback={
        <div className="flex-1 p-6 text-sm text-text-secondary">
          Loading Team issues…
        </div>
      }
    >
      <TeamWorkPage mode="issues" />
    </Suspense>
  )
}
