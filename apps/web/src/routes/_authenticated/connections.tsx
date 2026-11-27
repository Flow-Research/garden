import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * Back-compat: /connections moved to /connectors in the 2026-09 redesign
 * rename. Preserves connector_flow/connector_id params used by OAuth and app
 * install callbacks.
 */
export const Route = createFileRoute('/_authenticated/connections')({
  validateSearch: (search) => {
    const out: { connector_flow?: string; connector_id?: string } = {}
    if (typeof search.connector_flow === 'string')
      out.connector_flow = search.connector_flow
    if (typeof search.connector_id === 'string')
      out.connector_id = search.connector_id
    return out
  },
  beforeLoad: ({ search }) => {
    throw redirect({
      to: '/connectors',
      search: {
        connector_flow: search.connector_flow,
        connector_id: search.connector_id,
      },
      replace: true,
    })
  },
  component: () => null,
})
