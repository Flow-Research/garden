'use client'

import { useQuery } from '@tanstack/react-query'
import {
  IconBrandGithub,
  IconBrandGmail,
  IconBrandSlack,
} from '@tabler/icons-react'
import {
  Bot,
  Cable,
  Gauge,
  Link2,
  ShieldCheck,
  ShieldQuestion,
  ShieldX,
} from 'lucide-react'
import { Badge } from '@garden/ui/components/ui/badge'
import { Button } from '@garden/ui/components/ui/button'
import { useWorkspaceDock } from '@/components/shell/workspace-dock'
import { useAgentSessions } from '@/features/chat/use-agent-chat-sessions'
import { useSettingsDialogStore } from '@/features/settings'

type ConnectionTool = {
  name: string
  description: string
  riskClass: 'read' | 'write' | 'send_external' | 'destructive'
  invocationCount: number
}

type ConnectionItem = {
  id: 'gmail' | 'slack' | 'github'
  label: string
  description: string
  status: 'available' | 'connected' | 'degraded' | 'disconnected'
  scopes: string[]
  connectedAt: string | null
  toolCount: number
  recentInvocations: number
  grants: {
    auto: number
    allow: number
    ask: number
  }
  tools: ConnectionTool[]
}

type ConnectionsSnapshot = {
  summary: {
    connectorCount: number
    connectedCount: number
    toolCount: number
    recentInvocations: number
    agentCount: number
  }
  agents: Array<{
    id: string
    name: string
    status: string
  }>
  connectors: ConnectionItem[]
}

async function loadConnectionsSnapshot() {
  const response = await fetch('/api/connections', {
    credentials: 'include',
  })

  if (!response.ok) {
    throw new Error('Failed to load connections')
  }

  return (await response.json()) as ConnectionsSnapshot
}

function connectorIcon(id: ConnectionItem['id']) {
  switch (id) {
    case 'gmail':
      return IconBrandGmail
    case 'slack':
      return IconBrandSlack
    case 'github':
      return IconBrandGithub
  }
}

function riskBadgeVariant(riskClass: ConnectionTool['riskClass']) {
  switch (riskClass) {
    case 'destructive':
      return 'destructive'
    case 'send_external':
      return 'secondary'
    default:
      return 'outline'
  }
}

function statusVariant(status: ConnectionItem['status']) {
  switch (status) {
    case 'connected':
      return 'secondary'
    case 'degraded':
      return 'destructive'
    default:
      return 'outline'
  }
}

export function ConnectionsPage() {
  const { openPanel } = useWorkspaceDock()
  const { createSession } = useAgentSessions()
  const openSettings = useSettingsDialogStore((s) => s.openSettings)

  const snapshotQuery = useQuery({
    queryKey: ['workspace-connections'],
    queryFn: loadConnectionsSnapshot,
    staleTime: 20_000,
  })

  const snapshot = snapshotQuery.data

  if (snapshotQuery.isLoading || !snapshot) {
    return (
      <section className="flex h-full min-h-0 items-center justify-center px-6">
        <div className="space-y-2 text-center">
          <div className="text-sm font-medium">Loading connections</div>
          <div className="text-sm text-muted-foreground">
            Pulling connector status and tool coverage.
          </div>
        </div>
      </section>
    )
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-6 px-6 py-6">
        <section className="grid gap-4 border-b border-border pb-6 lg:grid-cols-[1.25fr_0.95fr]">
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
              <Cable className="size-3.5" />
              Connections
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight">
                Typed tools across the workspace
              </h1>
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                Connector health, available actions, and the trust posture your
                agents inherit when they reach for Gmail, Slack, or GitHub.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => openSettings()}
              >
                Open settings
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void createSession.mutateAsync('New Chat').then((session) => {
                    openPanel({
                      kind: 'chat',
                      title: session.title,
                      entityId: session.id,
                    })
                  })
                }}
              >
                Test in chat
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border">
            {[
              {
                label: 'Connected',
                value: snapshot.summary.connectedCount,
                icon: Link2,
              },
              {
                label: 'Tools',
                value: snapshot.summary.toolCount,
                icon: Gauge,
              },
              {
                label: 'Agents',
                value: snapshot.summary.agentCount,
                icon: Bot,
              },
              {
                label: 'Recent calls',
                value: snapshot.summary.recentInvocations,
                icon: ShieldCheck,
              },
            ].map((metric) => (
              <div key={metric.label} className="space-y-2 bg-background px-4 py-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    {metric.label}
                  </span>
                  <metric.icon className="size-4 text-muted-foreground" />
                </div>
                <div className="text-3xl font-semibold tracking-tight">
                  {metric.value}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-4">
            {snapshot.connectors.map((connector) => {
              const Icon = connectorIcon(connector.id)
              return (
                <section
                  key={connector.id}
                  className="overflow-hidden rounded-lg border border-border"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-4 py-4">
                    <div className="flex items-start gap-3">
                      <div className="flex size-11 items-center justify-center rounded-md border border-border bg-muted/50">
                        <Icon className="size-5" />
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <h2 className="text-base font-medium">
                            {connector.label}
                          </h2>
                          <Badge variant={statusVariant(connector.status)}>
                            {connector.status}
                          </Badge>
                        </div>
                        <p className="max-w-2xl text-sm text-muted-foreground">
                          {connector.description}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge variant="outline">{connector.toolCount} tools</Badge>
                      <Badge variant="outline">
                        {connector.recentInvocations} calls
                      </Badge>
                    </div>
                  </div>

                  <div className="grid gap-0 lg:grid-cols-[1.05fr_0.95fr]">
                    <div className="border-b border-border lg:border-r lg:border-b-0">
                      <div className="px-4 py-3 text-sm font-medium">Tool catalog</div>
                      <div>
                        {connector.tools.map((tool) => (
                          <div
                            key={tool.name}
                            className="flex flex-wrap items-start justify-between gap-3 border-t border-border px-4 py-3 first:border-t"
                          >
                            <div className="space-y-1">
                              <div className="font-medium">{tool.name}</div>
                              <div className="text-sm text-muted-foreground">
                                {tool.description}
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-sm">
                              <Badge variant={riskBadgeVariant(tool.riskClass)}>
                                {tool.riskClass.replaceAll('_', ' ')}
                              </Badge>
                              <span className="text-muted-foreground">
                                {tool.invocationCount} calls
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="px-4 py-3 text-sm font-medium">
                        Trust posture
                      </div>
                      <div className="space-y-3 px-4 py-1 pb-4">
                        <div className="grid grid-cols-3 gap-2 text-sm">
                          <div className="rounded-md border border-border bg-muted/30 px-3 py-3">
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <ShieldCheck className="size-4" />
                              Auto
                            </div>
                            <div className="mt-2 text-2xl font-semibold">
                              {connector.grants.auto}
                            </div>
                          </div>
                          <div className="rounded-md border border-border bg-muted/30 px-3 py-3">
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <ShieldQuestion className="size-4" />
                              Allow
                            </div>
                            <div className="mt-2 text-2xl font-semibold">
                              {connector.grants.allow}
                            </div>
                          </div>
                          <div className="rounded-md border border-border bg-muted/30 px-3 py-3">
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <ShieldX className="size-4" />
                              Ask
                            </div>
                            <div className="mt-2 text-2xl font-semibold">
                              {connector.grants.ask}
                            </div>
                          </div>
                        </div>

                        <div className="rounded-md border border-border bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
                          {connector.connectedAt
                            ? `Connected ${new Date(connector.connectedAt).toLocaleString()}`
                            : 'No live account has been linked in this workspace yet.'}
                        </div>

                        {connector.scopes.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {connector.scopes.map((scope) => (
                              <Badge key={scope} variant="outline">
                                {scope}
                              </Badge>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </section>
              )
            })}
          </div>

          <aside className="space-y-4 rounded-lg border border-border">
            <div className="border-b border-border px-4 py-4">
              <div className="text-sm font-medium">Agent coverage</div>
              <div className="text-sm text-muted-foreground">
                The current workspace agents that can consume connector tools.
              </div>
            </div>
            <div className="space-y-2 px-4 py-4">
              {snapshot.agents.map((agent) => (
                <div
                  key={agent.id}
                  className="flex items-center justify-between rounded-md border border-border bg-muted/20 px-3 py-3"
                >
                  <div>
                    <div className="font-medium">{agent.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {agent.status}
                    </div>
                  </div>
                  <Badge variant="outline">{agent.status}</Badge>
                </div>
              ))}
            </div>
          </aside>
        </section>
      </div>
    </div>
  )
}
