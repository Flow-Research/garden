import { Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { TeamOverview } from '@/features/teams/components/team-overview'
import { teamListOptions } from '@/features/teams/queries'
import { prefetchActiveWorkspace } from '@/lib/navigation/prefetch'

export const Route = createFileRoute('/_authenticated/_app/teams/')({
  loader: ({ context }) =>
    prefetchActiveWorkspace(context.queryClient, (workspaceId) => [
      teamListOptions(workspaceId),
    ]),
  component: TeamsIndexRoute,
})

function TeamsIndexRoute() {
  return (
    <Suspense
      fallback={
        <div className="flex-1 p-6 text-sm text-text-secondary">
          Loading Teams…
        </div>
      }
    >
      <TeamOverview />
    </Suspense>
  )
}
