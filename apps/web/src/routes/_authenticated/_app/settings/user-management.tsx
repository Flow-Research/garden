import { createFileRoute } from '@tanstack/react-router'
import { UserManagementTab } from '@/features/settings/components/user-management-tab'
import { teamListOptions } from '@/features/teams/queries'
import { prefetchActiveWorkspace } from '@/lib/navigation/prefetch'
import { memberListOptions } from '@/lib/workspace/queries'

export const Route = createFileRoute(
  '/_authenticated/_app/settings/user-management',
)({
  // ?view=team selects the Team sub-tab; Members is the default.
  validateSearch: (search): { view?: 'team' } =>
    search.view === 'team' ? { view: 'team' } : {},
  loader: ({ context }) =>
    prefetchActiveWorkspace(context.queryClient, (workspaceId) => [
      memberListOptions(workspaceId),
      teamListOptions(workspaceId),
    ]),
  component: UserManagementRoute,
})

function UserManagementRoute() {
  const { view } = Route.useSearch()
  return <UserManagementTab view={view ?? 'members'} />
}
