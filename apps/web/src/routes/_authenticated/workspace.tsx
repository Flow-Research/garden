import { createFileRoute, redirect } from '@tanstack/react-router'
import { getRouteSession } from '@/lib/server/route-session'
import { sanitizeRedirectTarget } from '@/lib/redirect'

/**
 * Back-compat redirect from the retired dock route. The FlexLayout workspace
 * dock was removed in the shell rebuild (2026-09 redesign): surfaces are
 * routed pages now. Old links land on /home; issue deep links (?issue=<id>,
 * e.g. from assignment emails) forward to the task detail route; connector
 * flow links forward to the connectors surface.
 *
 * Unauthenticated visitors are sent to /login with the FULL original URL as
 * the post-login redirect — beforeLoad children run before the parent auth
 * loader, so without this check an emailed ?issue= link opened while logged
 * out would lose the issue target.
 */
export const Route = createFileRoute('/_authenticated/workspace')({
  validateSearch: (search) => {
    const out: {
      connector_flow?: string
      connector_id?: string
      workspace_id?: string
      issue?: string
    } = {}
    if (typeof search.connector_flow === 'string')
      out.connector_flow = search.connector_flow
    if (typeof search.connector_id === 'string')
      out.connector_id = search.connector_id
    if (typeof search.workspace_id === 'string')
      out.workspace_id = search.workspace_id
    if (typeof search.issue === 'string') out.issue = search.issue
    return out
  },
  beforeLoad: async ({ search, location }) => {
    const session = await getRouteSession()
    if (!session) {
      throw redirect({
        to: '/login',
        search: { redirect: sanitizeRedirectTarget(location.href, '/home') },
      })
    }
    if (search.issue) {
      throw redirect({
        to: '/tasks/$issueId',
        params: { issueId: search.issue },
        search: search.workspace_id
          ? { workspace_id: search.workspace_id }
          : {},
      })
    }
    if (search.connector_flow || search.connector_id) {
      throw redirect({
        to: '/connectors',
        search: {
          connector_flow: search.connector_flow,
          connector_id: search.connector_id,
        },
      })
    }
    // Forward workspace_id — bootstrap reads it at SSR and persists it as the active org.
    throw redirect({
      to: '/home',
      search: search.workspace_id ? { workspace_id: search.workspace_id } : {},
    })
  },
  component: () => null,
})
