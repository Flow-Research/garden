import { createFileRoute } from '@tanstack/react-router'
import { UserManagementMembers } from '@/features/settings/components/user-management-tab'
import { prefetchActiveWorkspace } from '@/lib/navigation/prefetch'
import { memberListOptions } from '@/lib/workspace/queries'

export const Route = createFileRoute(
  '/_authenticated/_app/settings/user-management/members',
)({
  loader: ({ context }) =>
    prefetchActiveWorkspace(context.queryClient, (workspaceId) => [
      memberListOptions(workspaceId),
    ]),
  component: UserManagementMembers,
})
