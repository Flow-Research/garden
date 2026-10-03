import { Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { TeamWorkPage } from '@/features/teams/components/team-work-page'
import {
  allTeamIssuesOptions,
  teamListOptions,
} from '@/features/teams/queries'
import { prefetchActiveWorkspace } from '@/lib/navigation/prefetch'

export const Route = createFileRoute('/_authenticated/_app/teams/tasks')({
  loader: ({ context }) =>
    prefetchActiveWorkspace(context.queryClient, (workspaceId) => [
      allTeamIssuesOptions(workspaceId),
      teamListOptions(workspaceId),
    ]),
  component: TeamsTasksRoute,
})

function TeamsTasksRoute() {
  return (
    <Suspense
      fallback={
        <div className="flex-1 p-6 text-sm text-text-secondary">
          Loading Team tasks…
        </div>
      }
    >
      <TeamWorkPage mode="tasks" />
    </Suspense>
  )
}
