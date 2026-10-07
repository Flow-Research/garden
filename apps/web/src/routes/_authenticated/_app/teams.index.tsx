import { Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { TeamOverview } from '@/features/teams/components/team-overview'
import { TeamRouteError } from '@/features/teams/components/team-route-error'
import type { TeamMemberTab } from '@/features/teams/components/team-member-view'
import { teamListOptions } from '@/features/teams/queries'
import { prefetchActiveWorkspace } from '@/lib/navigation/prefetch'
import { memberListOptions } from '@/lib/workspace/queries'

export const Route = createFileRoute('/_authenticated/_app/teams/')({
  // Member view state: the selected Team and the active tab. Ignored by the
  // admin overview, which has no selector.
  validateSearch: (search) => {
    const out: { team?: string; tab?: TeamMemberTab } = {}
    if (typeof search.team === 'string') out.team = search.team
    if (search.tab === 'tasks') out.tab = 'tasks'
    return out
  },
  loader: ({ context }) =>
    prefetchActiveWorkspace(context.queryClient, (workspaceId) => [
      teamListOptions(workspaceId),
      memberListOptions(workspaceId),
    ]),
  component: TeamsIndexRoute,
  errorComponent: TeamRouteError,
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
