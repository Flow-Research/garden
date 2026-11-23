import { createFileRoute } from '@tanstack/react-router'
import { MembersTab } from '@/features/settings/components/members-tab'

export const Route = createFileRoute(
  '/_authenticated/_app/settings/user-management',
)({
  component: MembersTab,
})
