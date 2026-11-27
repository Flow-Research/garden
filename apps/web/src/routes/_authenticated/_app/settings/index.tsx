import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/_app/settings/')({
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/settings/profile', search, replace: true })
  },
})
