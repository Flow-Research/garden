import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { CircleAlert, CircleCheck } from 'lucide-react'
import { useWorkspaceId } from '@garden/app-state/hooks'
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '@garden/ui/components/ui/alert'
import { Button } from '@garden/ui/components/ui/button'
import { ConnectionsPage } from '@/features/connections'
import { getConnectorCallbackEvent } from '@/lib/api/connections'
import { connectionListOptions, workspaceKeys } from '@/lib/workspace/queries'
import { prefetchActiveWorkspace } from '@/lib/navigation/prefetch'

export const Route = createFileRoute('/_authenticated/_app/connectors')({
  // connector_flow + connector_id arrive from connector OAuth/setup callbacks
  // (built by connectorCallbackSearchParams); names stay stable for back-compat
  // with links already issued in emails/callbacks.
  validateSearch: (search) => {
    const out: { connector_flow?: string; connector_id?: string } = {}
    if (typeof search.connector_flow === 'string')
      out.connector_flow = search.connector_flow
    if (typeof search.connector_id === 'string')
      out.connector_id = search.connector_id
    return out
  },
  loader: ({ context }) =>
    prefetchActiveWorkspace(context.queryClient, (workspaceId) => [
      connectionListOptions(workspaceId),
    ]),
  component: ConnectionsRoute,
})

/**
 * Surfaces the outcome of a connector OAuth/setup callback where the provider
 * redirect lands.
 *
 * Why this exists: main rendered this notice in `WorkspaceLayout` at the old
 * `/workspace` boundary, but the shell rebuild deleted that component and
 * moved connector callbacks to `/connectors` (see `install.ts`). Main's
 * version opened a dock panel via `useRequiredWorkspaceDock`; the rebuilt
 * shell retired the dock, and this page already focuses the connector through
 * `focusedConnectorId`, so the action here only refreshes the connections
 * list and dismisses. Dismissal also strips the callback search params so a
 * reload does not replay the notice.
 */
function ConnectorCallbackNotice({
  connectorFlowId,
  connectorId,
}: {
  connectorFlowId?: string | null
  connectorId?: string | null
}) {
  const [dismissed, setDismissed] = useState(false)
  const queryClient = useQueryClient()
  const navigate = Route.useNavigate()
  const wsId = useWorkspaceId()
  const flowId = connectorFlowId?.trim() ?? ''
  const callback = useQuery({
    queryKey: ['connector-callback-event', flowId, connectorId ?? null],
    queryFn: () =>
      getConnectorCallbackEvent({ flowId, connectorId: connectorId ?? null }),
    enabled: flowId.length > 0,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  })

  if (!flowId || dismissed) return null

  const event = callback.data?.event
  const failed = callback.isError || event?.status === 'error'
  const title = callback.isPending
    ? 'Finishing connection'
    : failed
      ? 'Connection needs attention'
      : event?.status === 'degraded'
        ? `${event.connectorLabel} needs attention`
        : `${event?.connectorLabel ?? 'Connection'} connected`
  const description = callback.isPending
    ? 'Checking the provider callback status.'
    : callback.isError
      ? 'Review the provider status below and repair it.'
      : (event?.message ?? 'Provider access is ready.')

  const dismissNotice = () => {
    setDismissed(true)
    void navigate({ to: '/connectors', replace: true })
  }

  return (
    <Alert
      variant={failed ? 'destructive' : 'default'}
      className="mx-8 mt-4 w-auto"
    >
      {failed || event?.status === 'degraded' ? (
        <CircleAlert className="size-4" />
      ) : (
        <CircleCheck className="size-4" />
      )}
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
      <AlertAction className="flex gap-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            await queryClient.invalidateQueries({
              queryKey: workspaceKeys.connections(wsId),
            })
            dismissNotice()
          }}
        >
          Refresh
        </Button>
        <Button size="sm" variant="ghost" onClick={dismissNotice}>
          Dismiss
        </Button>
      </AlertAction>
    </Alert>
  )
}

function ConnectionsRoute() {
  const { connector_flow, connector_id } = Route.useSearch()
  const navigate = Route.useNavigate()
  const [dismissedFocusId, setDismissedFocusId] = useState<string | null>(null)
  const focusedConnectorId =
    connector_id && connector_id !== dismissedFocusId
      ? connector_id
      : undefined

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ConnectorCallbackNotice
        connectorFlowId={connector_flow}
        connectorId={connector_id}
      />
      <div className="min-h-0 flex-1">
        <ConnectionsPage
          focusedConnectorId={focusedConnectorId}
          onDismissFocus={() => {
            if (!connector_id) return
            setDismissedFocusId(connector_id)
            void navigate({ to: '/connectors', replace: true })
          }}
        />
      </div>
    </div>
  )
}
