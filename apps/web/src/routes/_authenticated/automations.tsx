import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * Back-compat: /automations moved to /workflows in the 2026-09 redesign
 * rename. Kept as a redirect so external links and bookmarks survive.
 */
export const Route = createFileRoute('/_authenticated/automations')({
  beforeLoad: () => {
    throw redirect({ to: '/workflows', replace: true })
  },
  component: () => null,
})
