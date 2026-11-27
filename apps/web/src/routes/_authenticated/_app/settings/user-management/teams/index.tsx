import { createFileRoute } from '@tanstack/react-router'
import { UserManagementTeams } from '@/features/settings/components/user-management-tab'
import { teamListOptions } from '@/features/teams/queries'
import { prefetchActiveWorkspace } from '@/lib/navigation/prefetch'
import { memberListOptions } from '@/lib/workspace/queries'

export const Route = createFileRoute(
  '/_authenticated/_app/settings/user-management/teams/',
)({
  loader: ({ context }) =>
    prefetchActiveWorkspace(context.queryClient, (workspaceId) => [
      memberListOptions(workspaceId),
      teamListOptions(workspaceId),
    ]),
  component: UserManagementTeams,
})
