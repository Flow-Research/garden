import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute(
  '/_authenticated/_app/settings/user-management/',
)({
  beforeLoad: () => {
    throw redirect({ to: '/settings/user-management/members', replace: true })
  },
})
