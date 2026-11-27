import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Option } from 'effect'
import {
  Building2,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  UserRound,
} from 'lucide-react'
import { Badge } from '@garden/ui/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@garden/ui/components/ui/select'
import { Skeleton } from '@garden/ui/components/ui/skeleton'
import { toast } from 'sonner'
import { useWorkspaceId } from '@garden/app-state/hooks'
import { api } from '@/lib/api'
import {
  agentAccessOptions,
  agentActivityOptions,
  connectionListOptions,
  workspaceKeys,
} from '@/lib/workspace/queries'

type ConnectionTrustValue = 'default' | 'allow' | 'ask'
type ToolTrustValue = 'default' | 'auto' | 'allow' | 'ask'

function trustLabel(trust: string) {
  switch (trust) {
    case 'auto':
      return 'Automatic'
    case 'allow':
      return 'Allowed'
    case 'ask':
      return 'Approval required'
    default:
      return 'Default'
  }
}

export function AgentAccessTab({ agentId }: { agentId: string }) {
  const wsId = useWorkspaceId()
  const qc = useQueryClient()
  const connectionsQuery = useQuery(connectionListOptions(wsId))
  const accessQuery = useQuery(agentAccessOptions(agentId))
  const activityQuery = useQuery(agentActivityOptions(agentId))
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const toggleExpanded = (connectorId: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(connectorId)) {
        next.delete(connectorId)
      } else {
        next.add(connectorId)
      }
      return next
    })
  }

  const invalidateAccess = () => {
    qc.invalidateQueries({ queryKey: workspaceKeys.agent(agentId) })
  }
  const handleMutationError = (err: unknown, message: string) => {
    toast.error(err instanceof Error ? err.message : message)
  }

  const connectionTrustMutation = useMutation({
    mutationFn: ({
      connectorId,
      trust,
    }: {
      connectorId: string
      trust: ConnectionTrustValue
    }) =>
      trust === 'default'
        ? api.deleteAgentConnectionTrust(agentId, connectorId)
        : api.setAgentConnectionTrust(agentId, connectorId, trust),
    onSuccess: invalidateAccess,
    onError: (err) => handleMutationError(err, 'Failed to update access'),
  })

  const toolTrustMutation = useMutation({
    mutationFn: ({
      connectorId,
      toolName,
      trust,
    }: {
      connectorId: string
      toolName: string
      trust: ToolTrustValue
    }) =>
      trust === 'default'
        ? api.deleteAgentToolTrust(agentId, connectorId, toolName)
        : api.setAgentToolTrust(agentId, connectorId, toolName, trust),
    onSuccess: invalidateAccess,
    onError: (err) => handleMutationError(err, 'Failed to update access'),
  })

  if (
    connectionsQuery.isPending ||
    accessQuery.isPending ||
    activityQuery.isPending
  ) {
    return (
      <section aria-labelledby={`agent-access-${agentId}`}>
        <Skeleton className="h-4 w-40" />
        <div className="mt-4 space-y-2">
          <Skeleton className="h-16 w-full rounded-md" />
          <Skeleton className="h-16 w-full rounded-md" />
        </div>
      </section>
    )
  }

  if (
    connectionsQuery.isError ||
    accessQuery.isError ||
    activityQuery.isError
  ) {
    return (
      <section aria-labelledby={`agent-access-${agentId}`}>
        <p className="text-sm text-muted-foreground">
          Could not load access state for this agent.
        </p>
      </section>
    )
  }

  const access = accessQuery.data
  const connectionTrustByConnector = new Map(
    access.connections.map((entry) => [entry.connector_id, entry.trust]),
  )
  const toolTrustByKey = new Map(
    access.tools.map((entry) => [
      `${entry.connector_id}:${entry.tool_name}`,
      entry,
    ]),
  )

  return (
    <section aria-labelledby={`agent-access-${agentId}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id={`agent-access-${agentId}`}
            className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground"
          >
            Agent access
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            Choose which connected accounts and tools this agent may use.
            Changes apply on the agent&apos;s next tool call.
          </p>
        </div>
      </div>

      <ul className="mt-4 divide-y divide-border/60 rounded-md border">
        {(connectionsQuery.data?.integrations ?? []).map((integration) => {
          const connectorId =
            Option.getOrNull(integration.gardenConnectorId) ?? integration.slug
          const managed = integration.gardenConnectorId._tag === 'Some'
          const connectionTrust =
            connectionTrustByConnector.get(connectorId) ?? null
          const firstConnection = integration.connections[0]
          const ownerLabel = firstConnection
            ? firstConnection.owner === 'org'
              ? 'Workspace'
              : 'Personal'
            : null
          const tools = integration.tools
            .map((tool) => ({
              name: tool.name,
              state: toolTrustByKey.get(`${connectorId}:${tool.name}`),
            }))
            .filter((tool) => tool.state !== undefined)
          const askCount = tools.filter(
            (tool) => tool.state?.trust === 'ask',
          ).length
          const toolsOpen = expanded.has(connectorId)
          return (
            <li key={connectorId} className="px-3 py-3">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/50 text-muted-foreground">
                  {ownerLabel === 'Workspace' ? (
                    <Building2 className="size-4" />
                  ) : (
                    <UserRound className="size-4" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-foreground">
                      {integration.label}
                    </p>
                    {ownerLabel ? (
                      <Badge variant="outline" className="text-[10px]">
                        {ownerLabel}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {firstConnection?.name ?? integration.label}
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      Connection default
                    </span>
                    {managed ? (
                      <Select
                        value={connectionTrust ?? 'default'}
                        onValueChange={(value) =>
                          connectionTrustMutation.mutate({
                            connectorId,
                            trust: value as ConnectionTrustValue,
                          })
                        }
                      >
                        <SelectTrigger className="h-7 w-36 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="default">Default</SelectItem>
                          <SelectItem value="allow">Allowed</SelectItem>
                          <SelectItem value="ask">Approval required</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        Custom integration
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Applies to every tool below unless overridden per tool.
                  </p>
                  {tools.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => toggleExpanded(connectorId)}
                      aria-expanded={toolsOpen}
                      className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                    >
                      {toolsOpen ? (
                        <ChevronDown className="size-3.5" />
                      ) : (
                        <ChevronRight className="size-3.5" />
                      )}
                      {tools.length} tools
                      {askCount > 0
                        ? ` · ${askCount} need${askCount === 1 ? 's' : ''} approval`
                        : ''}
                    </button>
                  ) : null}
                  {toolsOpen ? (
                    <ul className="mt-2 space-y-1.5">
                      {tools.map((tool) => (
                        <li
                          key={tool.name}
                          className="flex flex-wrap items-center justify-between gap-2 text-xs"
                        >
                          <span className="flex items-center gap-1.5 text-foreground">
                            <ShieldCheck className="size-3.5 text-muted-foreground" />
                            {tool.name}
                          </span>
                          <span className="flex items-center gap-2">
                            <span className="text-muted-foreground">
                              {trustLabel(tool.state?.trust ?? 'ask')}
                            </span>
                            {managed ? (
                              <Select
                                value={
                                  tool.state?.granted
                                    ? tool.state.trust
                                    : 'default'
                                }
                                onValueChange={(value) =>
                                  toolTrustMutation.mutate({
                                    connectorId,
                                    toolName: tool.name,
                                    trust: value as ToolTrustValue,
                                  })
                                }
                              >
                                <SelectTrigger className="h-7 w-36 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="default">
                                    Default
                                  </SelectItem>
                                  {tool.state?.risk_class === 'read' ? (
                                    <SelectItem value="auto">
                                      Automatic
                                    </SelectItem>
                                  ) : null}
                                  <SelectItem value="allow">Allowed</SelectItem>
                                  <SelectItem value="ask">
                                    Approval required
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
      <div className="mt-6">
        <h3 className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Recent activity
        </h3>
        {(activityQuery.data?.events ?? []).length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            No approvals, denials, or grant changes recorded for this agent yet.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-border/60 rounded-md border">
            {(activityQuery.data?.events ?? []).map((event) => (
              <li
                key={event.id}
                className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-xs"
              >
                <span className="text-foreground">
                  {event.kind === 'tool_decision'
                    ? `${event.tool_name} ${event.result_status}`
                    : `${event.scope === 'tool' ? (event.tool_name ?? event.connector_id) : event.connector_id} grant ${event.event_type === 'permission.grant.deleted' ? 'removed' : (event.trust ?? 'updated')}`}
                </span>
                <span className="text-muted-foreground">
                  {event.timestamp
                    ? new Date(event.timestamp).toLocaleString()
                    : 'Unknown time'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
