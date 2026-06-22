import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { format, formatDistanceToNowStrict } from 'date-fns'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Icon as IconifyIcon } from '@iconify/react'
import { useWorkspaceId } from '@garden/app-state/hooks'
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  MoreHorizontal,
  Plug,
} from 'lucide-react'
import { toast } from 'sonner'
import { getConnectorById } from '@garden/connectors'
import { defaultTrustLevelForRisk } from '@garden/connectors/capabilities'
import type { ConnectorId } from '@garden/connectors/registry'
import {
  getConnectorActivity,
  mutateConnection,
  updateToolGrant as updateConnectionToolGrant,
  type ConnectionAction,
  type ConnectionActivityItem,
  type ConnectionItem,
  type ConnectionTool,
  type ConnectionsSnapshot,
  type PermissionTrustLevel,
  type RiskClass,
} from '@/lib/api'
import { connectionListOptions, workspaceKeys } from '@/lib/workspace/queries'
import { notifyConnectionsChanged } from '@/features/connections/events'
import { Button } from '@garden/ui/components/ui/button'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@garden/ui/components/ui/drawer'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@garden/ui/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@garden/ui/components/ui/select'
import { authClient } from '@/lib/auth/client'

type ToolGroupKey = 'read' | 'write' | 'interactive'

const TOOL_GROUPS: Array<{
  key: ToolGroupKey
  label: string
  risks: RiskClass[]
}> = [
  { key: 'read', label: 'Read-only tools', risks: ['read'] },
  {
    key: 'write',
    label: 'Write / delete tools',
    risks: ['write', 'destructive'],
  },
  { key: 'interactive', label: 'Interactive tools', risks: ['send_external'] },
]

const GRANT_UPDATE_DEBOUNCE_MS = 450

function createConnectorFlowId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function connectorCallbackUrl(connectorId: ConnectorId, flowId: string) {
  const url = new URL(
    '/workspace',
    typeof window === 'undefined' ? 'http://localhost:3000' : window.location.origin,
  )
  url.searchParams.set('connector_flow', flowId)
  url.searchParams.set('connector_id', connectorId)
  return `${url.pathname}${url.search}`
}

function startGitHubAppInstall(flowId: string) {
  const url = new URL('/api/github/install', window.location.origin)
  url.searchParams.set('connector_flow', flowId)
  window.location.href = url.toString()
}

const CONNECTOR_ICON_ID: Record<ConnectorId, string | null> = {
  slack: 'logos:slack-icon',
  gmail: 'logos:google-gmail',
  'google-drive': 'logos:google-drive',
  github: 'logos:github-icon',
  'exa-search': 'simple-icons:exa',
  discord: 'simple-icons:discord',
}

function ConnectorIcon({
  id,
  className,
}: {
  id: ConnectorId
  className?: string
}) {
  const icon = CONNECTOR_ICON_ID[id]
  if (!icon) {
    return <Plug className={className} />
  }
  return <IconifyIcon icon={icon} className={className} />
}

function statusDotColor(status: ConnectionItem['status']) {
  switch (status) {
    case 'connected':
      return 'bg-emerald-500'
    case 'degraded':
      return 'bg-amber-500'
    case 'disconnected':
      return 'bg-red-500'
    default:
      return 'bg-zinc-500'
  }
}

function statusTextColor(status: ConnectionItem['status']) {
  switch (status) {
    case 'connected':
      return 'text-emerald-500'
    case 'degraded':
      return 'text-amber-500'
    case 'disconnected':
      return 'text-red-500'
    default:
      return 'text-muted-foreground'
  }
}

function groupOfRisk(risk: RiskClass): ToolGroupKey {
  if (risk === 'read') return 'read'
  if (risk === 'send_external') return 'interactive'
  return 'write'
}

function activityStatusColor(
  resultStatus: ConnectionActivityItem['resultStatus'],
) {
  switch (resultStatus) {
    case 'success':
      return 'text-emerald-500'
    case 'error':
    case 'timeout':
      return 'text-red-500'
    default:
      return 'text-muted-foreground'
  }
}

/**
 * Mirrors the MCP proxy's missing-row behavior so old workspaces display the
 * same default the runtime will enforce: read=auto, write=allow, sensitive=ask.
 */
function grantForTool(
  tool: ConnectionTool,
  agentId: string,
): PermissionTrustLevel {
  return tool.grantsByAgent[agentId] ?? defaultTrustLevelForRisk(tool.riskClass)
}

function bulkValueForTools(
  tools: ConnectionTool[],
  agentId: string | null,
): PermissionTrustLevel | 'mixed' {
  if (!tools.length || !agentId) return 'mixed'
  const first = grantForTool(tools[0], agentId)
  for (const tool of tools) {
    const value = grantForTool(tool, agentId)
    if (value !== first) return 'mixed'
  }
  return first
}

function countGrants(tools: ConnectionTool[]) {
  const grants = { auto: 0, allow: 0, ask: 0 }
  for (const tool of tools) {
    for (const trustLevel of Object.values(tool.grantsByAgent)) {
      grants[trustLevel] += 1
    }
  }
  return grants
}

function updateSnapshotToolGrant(
  snapshot: ConnectionsSnapshot,
  args: Parameters<typeof updateConnectionToolGrant>[0],
): ConnectionsSnapshot {
  return {
    ...snapshot,
    connectors: snapshot.connectors.map((connector) => {
      if (connector.id !== args.connectorId) return connector

      const tools = connector.tools.map((tool) =>
        tool.name === args.toolName
          ? {
              ...tool,
              grantsByAgent: {
                ...tool.grantsByAgent,
                [args.agentId]: args.trustLevel,
              },
            }
          : tool,
      )

      return {
        ...connector,
        grants: countGrants(tools),
        tools,
      }
    }),
  }
}

function pickDefaultConnector(
  connectors: ConnectionItem[],
  focusedId?: ConnectorId,
): ConnectionItem | null {
  if (focusedId) {
    const match = connectors.find((c) => c.id === focusedId)
    if (match) return match
  }
  const connected = connectors.find((c) => c.status === 'connected')
  if (connected) return connected
  return connectors[0] ?? null
}

export function ConnectionsPage({
  focusedConnectorId,
}: {
  focusedConnectorId?: ConnectorId
} = {}) {
  const queryClient = useQueryClient()
  const wsId = useWorkspaceId()
  const [activityOpen, setActivityOpen] = useState(false)
  const [launchingConnectorId, setLaunchingConnectorId] =
    useState<ConnectorId | null>(null)
  const pendingGrantUpdates = useRef<
    Map<
      string,
      {
        timeout: ReturnType<typeof setTimeout>
        args: Parameters<typeof updateToolGrant>[0]
      }
    >
  >(new Map())

  const snapshotQuery = useQuery({
    ...connectionListOptions(wsId),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  })
  const connectionMutation = useMutation({
    mutationFn: ({
      connectorId,
      action,
    }: {
      connectorId: ConnectorId
      action: ConnectionAction
    }) => mutateConnection(connectorId, action),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: workspaceKeys.connections(wsId),
        }),
        queryClient.invalidateQueries({
          queryKey: ['workspace-connections-sidebar'],
        }),
      ])
      notifyConnectionsChanged()
    },
  })
  const grantMutation = useMutation({
    mutationFn: updateConnectionToolGrant,
    onError: async (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Failed to update tool permission',
      )
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: workspaceKeys.connections(wsId),
        }),
        queryClient.invalidateQueries({
          queryKey: ['workspace-connections-sidebar'],
        }),
      ])
    },
  })

  useEffect(
    () => () => {
      for (const pending of pendingGrantUpdates.current.values()) {
        clearTimeout(pending.timeout)
      }
      pendingGrantUpdates.current.clear()
    },
    [],
  )

  const updateToolGrant = useCallback(
    (args: Parameters<typeof updateConnectionToolGrant>[0]) => {
      queryClient.setQueryData<ConnectionsSnapshot>(
        workspaceKeys.connections(wsId),
        (current) =>
          current ? updateSnapshotToolGrant(current, args) : current,
      )

      const key = `${args.connectorId}:${args.agentId}:${args.toolName}`
      const pending = pendingGrantUpdates.current.get(key)
      if (pending) clearTimeout(pending.timeout)

      const timeout = setTimeout(() => {
        const latest = pendingGrantUpdates.current.get(key)
        if (!latest) return
        pendingGrantUpdates.current.delete(key)
        grantMutation.mutate(latest.args)
      }, GRANT_UPDATE_DEBOUNCE_MS)

      pendingGrantUpdates.current.set(key, { timeout, args })
    },
    [grantMutation, queryClient, wsId],
  )

  const snapshot = snapshotQuery.data
  const connectors = snapshot?.connectors ?? []
  const agents = snapshot?.agents ?? []
  const connector = useMemo(
    () =>
      snapshot ? pickDefaultConnector(connectors, focusedConnectorId) : null,
    [connectors, focusedConnectorId, snapshot],
  )

  const selectedAgent = agents[0] ?? null

  const toolsByGroup = useMemo(() => {
    const map: Record<ToolGroupKey, ConnectionTool[]> = {
      read: [],
      write: [],
      interactive: [],
    }
    for (const tool of connector?.tools ?? []) {
      map[groupOfRisk(tool.riskClass)].push(tool)
    }
    return map
  }, [connector])

  if (snapshotQuery.isLoading || !snapshot) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />
        Loading connections
      </div>
    )
  }

  if (!connector) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <Plug className="size-6 opacity-60" />
        No connectors available
      </div>
    )
  }

  const connectorSpec = getConnectorById(connector.id)
  const isConnected = connector.status === 'connected'
  const isManaged = !connectorSpec?.oauth
  const canConfigureTools = isConnected && connector.tools.length > 0
  const statusLabel = isConnected
    ? 'Connected'
    : connector.status === 'degraded'
      ? 'Needs attention'
      : connector.status === 'disconnected'
        ? 'Disconnected'
        : 'Available'
  const connectionDetails = [
    connector.accountLogin ? `Account ${connector.accountLogin}` : null,
    connector.repositorySelection
      ? connector.repositorySelection === 'selected'
        ? 'Selected repositories'
        : 'All repositories'
      : null,
    connector.authKind ? connector.authKind.replace('_', ' ') : null,
  ].filter(Boolean)

  const handleBulkChange = (
    groupTools: ConnectionTool[],
    value: PermissionTrustLevel,
  ) => {
    if (!selectedAgent) return
    for (const tool of groupTools) {
      const current = grantForTool(tool, selectedAgent.id)
      if (current === value) continue
      updateToolGrant({
        connectorId: connector.id,
        toolName: tool.name,
        agentId: selectedAgent.id,
        trustLevel: value,
      })
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex items-start justify-between gap-4 px-8 pt-6 pb-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/40">
            <ConnectorIcon id={connector.id} className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-base font-semibold text-foreground">
                {connector.label}
              </h1>
              <span
                className={`size-2 shrink-0 rounded-full ring-2 ring-background ${statusDotColor(connector.status)}`}
                aria-hidden="true"
              />
              <span
                className={`shrink-0 text-xs font-medium ${statusTextColor(connector.status)}`}
              >
                {statusLabel}
              </span>
              {snapshotQuery.isFetching ? (
                <Loader2 className="size-3 animate-spin text-muted-foreground" />
              ) : null}
            </div>
            <p className="mt-1 max-w-prose text-xs text-muted-foreground">
              {connector.description}
            </p>
            {connectionDetails.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {connectionDetails.map((detail) => (
                  <span
                    key={detail}
                    className="rounded-full border border-border/60 bg-muted/30 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                  >
                    {detail}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {isManaged && !isConnected ? (
            <Button
              size="sm"
              className="h-7 text-xs"
              disabled={connectionMutation.isPending}
              onClick={() =>
                connectionMutation.mutate({
                  connectorId: connector.id,
                  action: 'resync',
                })
              }
            >
              {connectionMutation.isPending ? 'Syncing…' : 'Sync'}
            </Button>
          ) : null}
          {!isConnected && !isManaged ? (
            <Button
              size="sm"
              className="h-7 text-xs"
              disabled={
                connectionMutation.isPending ||
                launchingConnectorId === connector.id ||
                (connector.id !== 'github' && !connectorSpec?.oauth)
              }
              onClick={async () => {
                const flowId = createConnectorFlowId()
                setLaunchingConnectorId(connector.id)
                if (connector.id === 'github') {
                  startGitHubAppInstall(flowId)
                  return
                }
                if (!connectorSpec?.oauth) {
                  setLaunchingConnectorId(null)
                  return
                }
                const response = await authClient.oauth2.link({
                  providerId: connectorSpec.oauth.providerId,
                  callbackURL: connectorCallbackUrl(connector.id, flowId),
                })
                if (response.error) {
                  setLaunchingConnectorId(null)
                  toast.error(
                    response.error.message ??
                      `Failed to start ${connector.label} OAuth`,
                  )
                  return
                }
                // better-auth auto-redirects on { redirect: true } responses.
                // Fall back to a manual nav if not.
                if (response.data?.url && !response.data.redirect) {
                  window.location.href = response.data.url
                  return
                }
                setLaunchingConnectorId(null)
              }}
            >
              {launchingConnectorId === connector.id ? (
                <>
                  <Loader2 className="size-3 animate-spin" />
                  Opening…
                </>
              ) : connector.id === 'github' ? (
                connector.status === 'degraded' ? (
                  'Reconnect GitHub App'
                ) : (
                  'Install GitHub App'
                )
              ) : connector.status === 'degraded' ? (
                'Reconnect'
              ) : (
                'Connect'
              )}
            </Button>
          ) : null}

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  size="sm"
                  variant="ghost"
                  className="size-7 p-0 text-muted-foreground"
                  aria-label="More"
                >
                  <MoreHorizontal className="size-4" />
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => setActivityOpen(true)}>
                Recent activity
              </DropdownMenuItem>
              {isConnected || isManaged ? (
                <DropdownMenuItem
                  onClick={() =>
                    connectionMutation.mutate({
                      connectorId: connector.id,
                      action: 'resync',
                    })
                  }
                  disabled={connectionMutation.isPending}
                >
                  Resync tools
                </DropdownMenuItem>
              ) : null}
              {!isManaged && isConnected ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() =>
                      connectionMutation.mutate({
                        connectorId: connector.id,
                        action: 'disconnect',
                      })
                    }
                  >
                    Disconnect
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-10">
        <section className="mt-2">
          <h2 className="text-sm font-semibold text-foreground">
            Tool permissions
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Choose when {selectedAgent?.name ?? 'your agent'} is allowed to use
            these tools.
          </p>

          {!isConnected ? (
            <div className="mt-10 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <Plug className="size-5 opacity-60" />
              {isManaged
                ? 'Sync this provider to load its tools.'
                : connector.id === 'github'
                  ? 'Install the GitHub App to enable repository tools.'
                  : 'Connect this provider to load its tools.'}
            </div>
          ) : !canConfigureTools ? (
            <div className="mt-10 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <Plug className="size-5 opacity-60" />
              No tools discovered yet. Try resyncing.
            </div>
          ) : (
            <div className="mt-6 space-y-6">
              {TOOL_GROUPS.map((group) => {
                const tools = toolsByGroup[group.key]
                if (!tools.length) return null
                return (
                  <ToolGroup
                    key={group.key}
                    label={group.label}
                    tools={tools}
                    agentId={selectedAgent?.id ?? null}
                    onToolChange={(toolName, value) => {
                      if (!selectedAgent) return
                      updateToolGrant({
                        connectorId: connector.id,
                        toolName,
                        agentId: selectedAgent.id,
                        trustLevel: value,
                      })
                    }}
                    onBulkChange={(value) => handleBulkChange(tools, value)}
                    disabled={!selectedAgent}
                  />
                )
              })}
            </div>
          )}
        </section>
      </div>

      <Drawer
        open={activityOpen}
        onOpenChange={setActivityOpen}
        direction="right"
      >
        <DrawerContent className="data-[vaul-drawer-direction=right]:w-full data-[vaul-drawer-direction=right]:sm:max-w-2xl">
          <ActivityDrawerBody connector={connector} />
        </DrawerContent>
      </Drawer>
    </div>
  )
}

function ToolGroup({
  label,
  tools,
  agentId,
  onToolChange,
  onBulkChange,
  disabled,
}: {
  label: string
  tools: ConnectionTool[]
  agentId: string | null
  onToolChange: (toolName: string, value: PermissionTrustLevel) => void
  onBulkChange: (value: PermissionTrustLevel) => void
  disabled: boolean
}) {
  const [expanded, setExpanded] = useState(true)
  const bulk = bulkValueForTools(tools, agentId)
  const ChevronIcon = expanded ? ChevronDown : ChevronRight

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          className="flex items-center gap-1.5 text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase hover:text-foreground"
          onClick={() => setExpanded((v) => !v)}
        >
          <ChevronIcon className="size-3" />
          {label}
        </button>
        <BulkSelect value={bulk} onChange={onBulkChange} disabled={disabled} />
      </div>

      {expanded ? (
        <ul className="mt-2">
          {tools.map((tool) => {
            const value = agentId ? grantForTool(tool, agentId) : 'ask'
            return (
              <li
                key={tool.name}
                className="flex items-center justify-between gap-4 border-b border-border/40 py-2.5 last:border-b-0"
              >
                <span
                  className="min-w-0 flex-1 truncate text-sm text-foreground"
                  title={tool.description || tool.name}
                >
                  {formatToolName(tool.name)}
                </span>
                <PermissionSegment
                  value={value}
                  onChange={(next) => onToolChange(tool.name, next)}
                  disabled={disabled}
                />
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}

function formatToolName(raw: string) {
  const cleaned = raw.replace(/[_-]+/g, ' ').trim()
  if (!cleaned) return raw
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}

function BulkSelect({
  value,
  onChange,
  disabled,
}: {
  value: PermissionTrustLevel | 'mixed'
  onChange: (value: PermissionTrustLevel) => void
  disabled: boolean
}) {
  const label =
    value === 'mixed'
      ? 'Mixed'
      : value === 'auto'
        ? 'Auto'
        : value === 'allow'
          ? 'Allow'
          : 'Ask'

  return (
    <Select
      value={value === 'mixed' ? null : value}
      onValueChange={(v) => {
        if (!v) return
        onChange(v as PermissionTrustLevel)
      }}
      disabled={disabled}
    >
      <SelectTrigger
        size="sm"
        className="h-6 min-w-[78px] gap-1 rounded-md border-border/60 px-2 text-[11px] text-muted-foreground"
      >
        <span>{label}</span>
      </SelectTrigger>
      <SelectContent align="end">
        <SelectItem value="auto">Auto</SelectItem>
        <SelectItem value="allow">Allow</SelectItem>
        <SelectItem value="ask">Ask</SelectItem>
      </SelectContent>
    </Select>
  )
}

const SEGMENT_OPTIONS: Array<{ value: PermissionTrustLevel; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'allow', label: 'Allow' },
  { value: 'ask', label: 'Ask' },
]

function PermissionSegment({
  value,
  onChange,
  disabled,
}: {
  value: PermissionTrustLevel
  onChange: (value: PermissionTrustLevel) => void
  disabled: boolean
}) {
  return (
    <div
      role="radiogroup"
      className="inline-flex items-center rounded-md border border-border/60 bg-muted/30 p-0.5 text-[11px]"
    >
      {SEGMENT_OPTIONS.map((option) => {
        const active = option.value === value
        const activeClass =
          option.value === 'allow'
            ? 'text-emerald-500'
            : option.value === 'ask'
              ? 'text-amber-500'
              : 'text-foreground'
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => {
              if (!active) onChange(option.value)
            }}
            className={[
              'h-6 rounded-sm px-2.5 font-medium transition-colors',
              active
                ? `bg-background shadow-sm ${activeClass}`
                : 'text-muted-foreground hover:text-foreground',
              disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
            ].join(' ')}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function ActivityDrawerBody({ connector }: { connector: ConnectionItem }) {
  const activityQuery = useQuery({
    queryKey: ['connector-activity', connector.id],
    queryFn: () => getConnectorActivity(connector.id),
    staleTime: 15_000,
  })
  const activity = useMemo(
    () => activityQuery.data?.activity ?? [],
    [activityQuery.data],
  )

  return (
    <>
      <DrawerHeader className="border-b">
        <DrawerTitle>{connector.label} activity</DrawerTitle>
        <DrawerDescription>
          Last 50 tool calls in this workspace.
        </DrawerDescription>
      </DrawerHeader>
      <div className="flex-1 overflow-y-auto">
        {activityQuery.isLoading ? (
          <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" />
            Loading
          </div>
        ) : activityQuery.isError ? (
          <div className="px-6 py-4 text-sm text-destructive">
            {activityQuery.error instanceof Error
              ? activityQuery.error.message
              : 'Failed to load'}
          </div>
        ) : activity.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-muted-foreground">
            No tool calls yet.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {activity.map((entry) => (
              <li key={entry.id} className="flex items-center gap-3 px-6 py-3">
                <span
                  className={`shrink-0 text-xs font-medium ${activityStatusColor(entry.resultStatus)}`}
                >
                  {entry.resultStatus}
                </span>
                <span className="flex-1 truncate font-mono text-xs">
                  {entry.toolName}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {entry.agent.name}
                </span>
                <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">
                  {entry.durationMs}ms
                </span>
                <span
                  className="w-24 shrink-0 text-right text-xs text-muted-foreground"
                  title={format(
                    new Date(entry.timestamp),
                    "MMM d, yyyy 'at' h:mm a",
                  )}
                >
                  {formatDistanceToNowStrict(new Date(entry.timestamp), {
                    addSuffix: true,
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
