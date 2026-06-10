import { createFileRoute } from '@tanstack/react-router'
import { WorkspaceLayout } from '@/components/shell/workspace-layout'

/**
 * The workspace renders the FlexLayout dock, which is client-only by
 * construction: FlexLayout's `TabNode` constructor calls
 * `document.createElement('div')` unconditionally, so `Model.fromJson` (run in
 * the dock provider's `useState` initializer) throws `document is not defined`
 * during SSR. The dashboard has no SSR/SEO requirement, so we opt this route
 * out of server rendering with TanStack Start's per-route `ssr: false`. The
 * parent `/_authenticated` route keeps server-side auth (its loader runs the
 * auth bootstrap + redirect on the server); only this child renders
 * client-only. There is no loader here, so nothing server-side is lost.
 * Ref: TanStack Start selective SSR — `ssr: false` renders the route component
 * on the client (start-core execution-model / server-components docs).
 */
export const Route = createFileRoute('/_authenticated/workspace')({
  // DO NOT flip to true: FlexLayout's model construction touches `document`, so
  // SSR of this route crashes with "document is not defined". See JSDoc above.
  ssr: false,
  validateSearch: (search) => ({
    connector_flow:
      typeof search.connector_flow === 'string'
        ? search.connector_flow
        : undefined,
    connector_id:
      typeof search.connector_id === 'string' ? search.connector_id : undefined,
  }),
  component: WorkspaceRoute,
})

function WorkspaceRoute() {
  const search = Route.useSearch()
  return (
    <WorkspaceLayout
      connectorFlowId={search.connector_flow ?? null}
      connectorId={search.connector_id ?? null}
    />
  )
}
