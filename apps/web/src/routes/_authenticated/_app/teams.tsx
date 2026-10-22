import { Outlet, createFileRoute } from '@tanstack/react-router'

/**
 * Teams layout: the tab strip lives in the app shell's top bar, so this route
 * only needs to provide the outlet for the overview and detail children.
 */
export const Route = createFileRoute('/_authenticated/_app/teams')({
  component: TeamsLayoutRoute,
})

function TeamsLayoutRoute() {
  return <Outlet />
}
