'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Bot,
  Cable,
  CircleDot,
  GitBranch,
  Inbox as InboxIcon,
  Link2,
  Mail,
  MessageSquareMore,
  ShieldAlert,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Badge } from '@garden/ui/components/ui/badge'
import { Skeleton } from '@garden/ui/components/ui/skeleton'
import { cn } from '@garden/ui/lib/utils'
import { useWorkspaceStore } from '@garden/core/workspace'
import { STATUS_CONFIG } from '@garden/core/issues/config'
import type { IssuePriority, IssueStatus } from '@garden/core/types'
import { PriorityIcon, StatusIcon } from '@/features/issues/components'
import { useWorkspaceDock } from '@/components/shell/workspace-dock'

type DashboardIssue = {
  id: string
  title: string
  status: IssueStatus
  priority: IssuePriority
  updatedAt: string
  assigneeType: string | null
}

type DashboardAgent = {
  id: string
  name: string
  status: string
  roleTitle: string | null
  activeIssueCount: number
}

type DashboardInboxItem = {
  id: string
  title: string
  issue_id: string
  type: string
  severity: string
  created_at: string
}

type DashboardConnection = {
  id: string
  label: string
  status: string
  toolCount: number
}

type DashboardBucket = { name: string; value: number; color: string }

type DashboardSnapshot = {
  workspace: {
    id: string
    name: string
    description: string | null
    context: string | null
  }
  summary: {
    totalIssues: number
    openIssues: number
    blockedIssues: number
    completedIssues: number
    agentCount: number
    skillCount: number
    connectedCount: number
    unreadCount: number
  }
  issueStatus: DashboardBucket[]
  issuePriority: DashboardBucket[]
  recentIssues: DashboardIssue[]
  inbox: DashboardInboxItem[]
  agents: DashboardAgent[]
  connections: DashboardConnection[]
}

async function loadDashboardSnapshot() {
  const response = await fetch('/api/dashboard', {
    credentials: 'include',
  })

  if (!response.ok) {
    throw new Error('Failed to load dashboard')
  }

  return (await response.json()) as DashboardSnapshot
}

function timeAgo(date: string) {
  const delta = Date.now() - new Date(date).getTime()
  const minutes = Math.max(1, Math.round(delta / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  return `${days}d`
}

function connectionIcon(id: string): LucideIcon {
  switch (id) {
    case 'gmail':
      return Mail
    case 'slack':
      return MessageSquareMore
    case 'github':
      return GitBranch
    default:
      return Cable
  }
}

function MetricCard({
  icon: Icon,
  value,
  label,
  description,
  onClick,
}: {
  icon: LucideIcon
  value: string | number
  label: string
  description?: React.ReactNode
  onClick?: () => void
}) {
  const isClickable = !!onClick
  const Inner = (
    <div
      className={cn(
        'h-full rounded-lg px-4 py-4 sm:px-5 sm:py-5 transition-colors',
        isClickable && 'cursor-pointer hover:bg-accent/50',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">
            {value}
          </p>
          <p className="mt-1 text-xs font-medium text-muted-foreground sm:text-sm">
            {label}
          </p>
          {description ? (
            <div className="mt-1.5 hidden text-xs text-muted-foreground/70 sm:block">
              {description}
            </div>
          ) : null}
        </div>
        <Icon className="mt-1.5 h-4 w-4 shrink-0 text-muted-foreground/50" />
      </div>
    </div>
  )

  if (!isClickable) return Inner
  return (
    <button type="button" onClick={onClick} className="block h-full text-left">
      {Inner}
    </button>
  )
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div>
        <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
        {subtitle ? (
          <span className="text-[10px] text-muted-foreground/60">
            {subtitle}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  )
}

function DistributionBars({
  entries,
  emptyLabel,
}: {
  entries: DashboardBucket[]
  emptyLabel: string
}) {
  const total = entries.reduce((sum, entry) => sum + entry.value, 0)

  if (total === 0) {
    return <p className="text-xs text-muted-foreground">{emptyLabel}</p>
  }

  const max = Math.max(...entries.map((entry) => entry.value), 1)

  return (
    <div className="space-y-2">
      {entries.map((entry) => {
        const widthPct = Math.max(4, Math.round((entry.value / max) * 100))
        return (
          <div key={entry.name} className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-1.5 truncate text-foreground">
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: entry.color }}
                />
                <span className="truncate capitalize">{entry.name}</span>
              </span>
              <span className="tabular-nums text-muted-foreground">
                {entry.value}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted/50">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${widthPct}%`,
                  backgroundColor: entry.color,
                }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6 px-6 py-6">
      <div className="grid grid-cols-2 gap-1 sm:gap-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-lg" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Skeleton className="h-48 rounded-lg" />
        <Skeleton className="h-48 rounded-lg" />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-64 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    </div>
  )
}

export function DashboardPage() {
  const workspace = useWorkspaceStore((state) => state.workspace)
  const { openPanel } = useWorkspaceDock()

  const dashboardQuery = useQuery({
    queryKey: ['workspace-dashboard', workspace?.id ?? 'none'],
    queryFn: loadDashboardSnapshot,
    enabled: !!workspace?.id,
    staleTime: 20_000,
  })

  const snapshot = dashboardQuery.data

  const statusBuckets = useMemo(
    () => snapshot?.issueStatus.filter((entry) => entry.value > 0) ?? [],
    [snapshot?.issueStatus],
  )
  const priorityBuckets = useMemo(
    () => snapshot?.issuePriority.filter((entry) => entry.value > 0) ?? [],
    [snapshot?.issuePriority],
  )

  if (!workspace?.id) return null

  if (dashboardQuery.isLoading || !snapshot) {
    return <DashboardSkeleton />
  }

  const openIssues = () => openPanel({ kind: 'issues', title: 'Tasks' })
  const openInbox = () => openPanel({ kind: 'inbox', title: 'Inbox' })
  const openConnections = () =>
    openPanel({ kind: 'capabilities', title: 'Connections' })
  const openIssueDetail = (issue: { id: string; title: string }) =>
    openPanel({
      kind: 'issue-detail',
      title: issue.title,
      entityId: issue.id,
    })

  const hasAgents = snapshot.summary.agentCount > 0

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-[1360px] space-y-6 px-6 py-6">
        {dashboardQuery.error ? (
          <p className="text-sm text-destructive">
            {dashboardQuery.error instanceof Error
              ? dashboardQuery.error.message
              : 'Failed to load dashboard'}
          </p>
        ) : null}

        {!hasAgents ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-500/25 dark:bg-amber-950/60">
            <div className="flex items-center gap-2.5">
              <Bot className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-sm text-amber-900 dark:text-amber-100">
                You have no agents.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                openPanel({ kind: 'capabilities', title: 'Connections' })
              }
              className="shrink-0 text-sm font-medium text-amber-700 underline underline-offset-2 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100"
            >
              Set one up
            </button>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-1 sm:gap-2 xl:grid-cols-4">
          <MetricCard
            icon={CircleDot}
            value={snapshot.summary.openIssues}
            label="Open Work"
            onClick={openIssues}
            description={
              <span>
                {snapshot.summary.totalIssues} total,{' '}
                {snapshot.summary.completedIssues} done
              </span>
            }
          />
          <MetricCard
            icon={ShieldAlert}
            value={snapshot.summary.blockedIssues}
            label="Blocked"
            onClick={openIssues}
            description={
              <span>
                {snapshot.summary.blockedIssues === 0
                  ? 'Nothing stuck right now'
                  : 'Needs a human to unblock'}
              </span>
            }
          />
          <MetricCard
            icon={Bot}
            value={snapshot.summary.agentCount}
            label="Agents"
            description={
              <span>{snapshot.summary.skillCount} skills available</span>
            }
          />
          <MetricCard
            icon={Link2}
            value={snapshot.summary.connectedCount}
            label="Connected Apps"
            onClick={openConnections}
            description={
              <span>
                {snapshot.connections.length - snapshot.summary.connectedCount}{' '}
                pending
              </span>
            }
          />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard
            title="Issues by Status"
            subtitle={`${snapshot.summary.totalIssues} total`}
          >
            <DistributionBars
              entries={statusBuckets}
              emptyLabel="No issues yet"
            />
          </ChartCard>
          <ChartCard
            title="Issues by Priority"
            subtitle={`${snapshot.summary.openIssues} open`}
          >
            <DistributionBars
              entries={priorityBuckets}
              emptyLabel="No issues yet"
            />
          </ChartCard>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="min-w-0">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Recent Activity
              </h3>
              {snapshot.summary.unreadCount > 0 ? (
                <button
                  type="button"
                  onClick={openInbox}
                  className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                >
                  {snapshot.summary.unreadCount} in inbox
                </button>
              ) : null}
            </div>
            {snapshot.inbox.length === 0 ? (
              <div className="flex items-center gap-2 border border-border p-4 text-sm text-muted-foreground">
                <InboxIcon className="h-4 w-4 shrink-0" />
                Inbox is clear.
              </div>
            ) : (
              <div className="divide-y divide-border overflow-hidden border border-border">
                {snapshot.inbox.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() =>
                      openIssueDetail({ id: item.issue_id, title: item.title })
                    }
                    className="block w-full cursor-pointer px-4 py-2 text-left text-sm transition-colors hover:bg-accent/50"
                  >
                    <div className="flex items-center gap-3">
                      <p className="min-w-0 flex-1 truncate">
                        <span className="font-medium">{item.title}</span>
                        <span className="ml-1 text-muted-foreground">
                          — {item.type.replaceAll('_', ' ')}
                        </span>
                      </p>
                      <span className="shrink-0 pt-0.5 text-xs text-muted-foreground">
                        {timeAgo(item.created_at)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="min-w-0">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Recent Tasks
              </h3>
              <button
                type="button"
                onClick={openIssues}
                className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                View all
              </button>
            </div>
            {snapshot.recentIssues.length === 0 ? (
              <div className="border border-border p-4">
                <p className="text-sm text-muted-foreground">No tasks yet.</p>
              </div>
            ) : (
              <div className="divide-y divide-border overflow-hidden border border-border">
                {snapshot.recentIssues.slice(0, 10).map((issue) => (
                  <button
                    key={issue.id}
                    type="button"
                    onClick={() => openIssueDetail(issue)}
                    className="block w-full cursor-pointer px-4 py-3 text-left text-sm transition-colors hover:bg-accent/50"
                  >
                    <div className="flex items-center gap-3">
                      <StatusIcon
                        status={issue.status}
                        className="h-3.5 w-3.5"
                      />
                      <PriorityIcon
                        priority={issue.priority}
                        className="h-3.5 w-3.5"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {issue.title}
                      </span>
                      <span className="shrink-0 text-xs capitalize text-muted-foreground">
                        {STATUS_CONFIG[issue.status]?.label ?? issue.status}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {timeAgo(issue.updatedAt)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {snapshot.agents.length > 0 || snapshot.connections.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2">
            {snapshot.agents.length > 0 ? (
              <div className="min-w-0">
                <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Agents
                </h3>
                <div className="divide-y divide-border overflow-hidden border border-border">
                  {snapshot.agents.map((agent) => (
                    <div
                      key={agent.id}
                      className="flex items-center gap-3 px-4 py-2 text-sm"
                    >
                      <Bot className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{agent.name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {agent.roleTitle ?? 'Workspace agent'}
                        </div>
                      </div>
                      <Badge variant="outline" className="capitalize">
                        {agent.status}
                      </Badge>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {agent.activeIssueCount} active
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {snapshot.connections.length > 0 ? (
              <div className="min-w-0">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Connections
                  </h3>
                  <button
                    type="button"
                    onClick={openConnections}
                    className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                  >
                    Manage
                  </button>
                </div>
                <div className="divide-y divide-border overflow-hidden border border-border">
                  {snapshot.connections.map((connection) => {
                    const Icon = connectionIcon(connection.id)
                    return (
                      <button
                        key={connection.id}
                        type="button"
                        onClick={openConnections}
                        className="flex w-full cursor-pointer items-center gap-3 px-4 py-2 text-left text-sm transition-colors hover:bg-accent/50"
                      >
                        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">
                            {connection.label}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {connection.toolCount} tools
                          </div>
                        </div>
                        <Badge
                          variant={
                            connection.status === 'connected'
                              ? 'secondary'
                              : 'outline'
                          }
                          className="capitalize"
                        >
                          {connection.status}
                        </Badge>
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

