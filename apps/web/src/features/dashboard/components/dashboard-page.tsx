import { Component, Suspense, useCallback, useMemo } from 'react'
import { Skeleton as BoneyardSkeleton } from 'boneyard-js/react'
import {
  useQueryErrorResetBoundary,
  useSuspenseQuery,
} from '@tanstack/react-query'
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
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@garden/ui/components/ui/alert'
import { Badge } from '@garden/ui/components/ui/badge'
import { Button } from '@garden/ui/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@garden/ui/components/ui/empty'
import { cn } from '@garden/ui/lib/utils'
import { useWorkspaceId } from '@garden/app-state/hooks'
import { STATUS_CONFIG } from '@garden/core/issues/config'
import { PriorityIcon, StatusIcon } from '@/features/issues/components'
import { useWorkspaceDock } from '@/components/shell/workspace-dock'
import {
  dashboardActivityOptions,
  dashboardDistributionOptions,
  dashboardOverviewOptions,
  dashboardResourcesOptions,
} from '../dashboard.queries'
import type { DashboardBucket } from '../dashboard.server'

const DASHBOARD_PAGE_SKELETON = 'dashboard-page'

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
        'h-full rounded-2xl px-5 py-5 sm:px-6 sm:py-6 transition-all bg-[color:var(--vellum)] backdrop-blur-xl saturate-105 shadow-[var(--shadow-hairline)]',
        isClickable &&
          'cursor-pointer hover:bg-[color:var(--vellum-heavy)] hover:shadow-[var(--shadow-float-1)]',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-3xl font-semibold tracking-tight tabular-nums text-[color:var(--ink)] sm:text-[2rem]">
            {value}
          </p>
          <p className="mt-1.5 text-xs font-medium text-[color:var(--gravel)] sm:text-sm">
            {label}
          </p>
          {description ? (
            <div className="mt-2 hidden text-xs text-[color:var(--slate)] sm:block">
              {description}
            </div>
          ) : null}
        </div>
        <Icon className="mt-1 h-4 w-4 shrink-0 text-[color:var(--slate)]" />
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
    <div className="space-y-3 rounded-2xl p-5 bg-[color:var(--vellum)] backdrop-blur-xl saturate-105 shadow-[var(--shadow-hairline)]">
      <div>
        <h3 className="text-[10px] font-medium uppercase tracking-[0.16em] text-[color:var(--gravel)]">
          {title}
        </h3>
        {subtitle ? (
          <span className="text-[10px] text-[color:var(--slate)]">
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

function SectionPlaceholder({ className }: { className?: string }) {
  return <div className={cn('rounded-md bg-muted/60', className)} />
}

function DashboardMetricGridFallback() {
  return (
    <div className="grid grid-cols-2 gap-1 sm:gap-2 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={`metric-fallback-${index}`}
          className="rounded-2xl bg-[color:var(--vellum)] backdrop-blur-xl saturate-105 shadow-[var(--shadow-hairline)] px-4 py-4 sm:px-5 sm:py-5"
        >
          <SectionPlaceholder className="h-8 w-16" />
          <SectionPlaceholder className="mt-2 h-3 w-24" />
          <SectionPlaceholder className="mt-3 h-3 w-28" />
        </div>
      ))}
    </div>
  )
}

function DashboardChartSectionFallback() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {Array.from({ length: 2 }).map((_, index) => (
        <div
          key={`chart-fallback-${index}`}
          className="space-y-3 rounded-2xl bg-[color:var(--vellum)] backdrop-blur-xl saturate-105 shadow-[var(--shadow-hairline)] p-4"
        >
          <SectionPlaceholder className="h-3 w-28" />
          <SectionPlaceholder className="h-2 w-20" />
          <div className="space-y-3 pt-2">
            {Array.from({ length: 3 }).map((__, rowIndex) => (
              <div
                key={`chart-row-${index}-${rowIndex}`}
                className="space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <SectionPlaceholder className="h-3 w-20" />
                  <SectionPlaceholder className="h-3 w-6" />
                </div>
                <SectionPlaceholder className="h-1.5 w-full" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function DashboardListSectionFallback({ title }: { title: string }) {
  return (
    <div className="min-w-0">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.16em] text-[color:var(--gravel)]">
          {title}
        </h3>
        <SectionPlaceholder className="h-3 w-14" />
      </div>
      <div className="divide-y divide-[color:var(--hairline-soft)] overflow-hidden rounded-2xl bg-[color:var(--vellum)] backdrop-blur-xl saturate-105 shadow-[var(--shadow-hairline)]">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={`${title}-fallback-${index}`} className="px-4 py-3">
            <SectionPlaceholder className="h-4 w-3/4" />
            <SectionPlaceholder className="mt-2 h-3 w-24" />
          </div>
        ))}
      </div>
    </div>
  )
}

function DashboardResourceSectionFallback({ title }: { title: string }) {
  return (
    <div className="min-w-0">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.16em] text-[color:var(--gravel)]">
          {title}
        </h3>
        <SectionPlaceholder className="h-3 w-14" />
      </div>
      <div className="divide-y divide-[color:var(--hairline-soft)] overflow-hidden rounded-2xl bg-[color:var(--vellum)] backdrop-blur-xl saturate-105 shadow-[var(--shadow-hairline)]">
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={`${title}-resource-${index}`}
            className="flex items-center gap-3 px-4 py-3"
          >
            <SectionPlaceholder className="h-4 w-4 rounded-full" />
            <div className="min-w-0 flex-1">
              <SectionPlaceholder className="h-4 w-28" />
              <SectionPlaceholder className="mt-2 h-3 w-20" />
            </div>
            <SectionPlaceholder className="h-6 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  )
}

function DashboardSectionError({
  error,
  onRetry,
}: {
  error: Error
  onRetry: () => void
}) {
  return (
    <div className="border-l-2 border-destructive/60 pl-4">
      <p className="text-sm font-medium text-destructive">
        Dashboard section failed
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {error.message || 'Something went wrong while loading this section.'}
      </p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="mt-3"
        onClick={onRetry}
      >
        Retry
      </Button>
    </div>
  )
}

type DashboardErrorBoundaryProps = {
  children: React.ReactNode
  fallbackRender: (args: { error: Error; reset: () => void }) => React.ReactNode
  onReset?: () => void
}

type DashboardErrorBoundaryState = {
  error: Error | null
}

class DashboardErrorBoundary extends Component<
  DashboardErrorBoundaryProps,
  DashboardErrorBoundaryState
> {
  state: DashboardErrorBoundaryState = {
    error: null,
  }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  reset = () => {
    this.props.onReset?.()
    this.setState({ error: null })
  }

  render() {
    if (this.state.error) {
      return this.props.fallbackRender({
        error: this.state.error,
        reset: this.reset,
      })
    }

    return this.props.children
  }
}

function DashboardSectionBoundary({
  children,
  fallback,
}: {
  children: React.ReactNode
  fallback: React.ReactNode
}) {
  const { reset } = useQueryErrorResetBoundary()

  return (
    <DashboardErrorBoundary
      onReset={reset}
      fallbackRender={({ error, reset: resetBoundary }) => (
        <DashboardSectionError error={error} onRetry={resetBoundary} />
      )}
    >
      <Suspense fallback={fallback}>{children}</Suspense>
    </DashboardErrorBoundary>
  )
}

function DashboardPageFixture() {
  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-[1360px] space-y-6 px-6 py-6">
        <div className="grid grid-cols-2 gap-1 sm:gap-2 xl:grid-cols-4">
          {[
            ['18', 'Open Work'],
            ['3', 'Blocked'],
            ['12', 'Unread'],
            ['4', 'Connections'],
          ].map(([value, label]) => (
            <div
              key={label}
              className="h-full rounded-2xl bg-[color:var(--vellum)] backdrop-blur-xl saturate-105 shadow-[var(--shadow-hairline)] px-4 py-4 sm:px-5 sm:py-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">
                    {value}
                  </p>
                  <p className="mt-1 text-xs font-medium text-muted-foreground sm:text-sm">
                    {label}
                  </p>
                </div>
                <div className="mt-1.5 h-4 w-4 rounded-full bg-muted-foreground/30" />
              </div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard title="Issue Status" subtitle="Current distribution">
            <DistributionBars
              emptyLabel="No status data"
              entries={[
                { name: 'backlog', value: 7, color: '#64748b' },
                { name: 'in progress', value: 5, color: '#0ea5e9' },
                { name: 'done', value: 6, color: '#22c55e' },
              ]}
            />
          </ChartCard>
          <ChartCard title="Issue Priority" subtitle="Current distribution">
            <DistributionBars
              emptyLabel="No priority data"
              entries={[
                { name: 'high', value: 4, color: '#ef4444' },
                { name: 'medium', value: 8, color: '#f59e0b' },
                { name: 'low', value: 6, color: '#22c55e' },
              ]}
            />
          </ChartCard>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3 rounded-2xl bg-[color:var(--vellum)] backdrop-blur-xl saturate-105 shadow-[var(--shadow-hairline)] p-4">
            <h3 className="text-xs font-medium text-muted-foreground">
              Recent Issues
            </h3>
            {[
              'Refine inbox filters',
              'Wire issue comments',
              'Ship auth gate',
            ].map((title) => (
              <div
                key={title}
                className="flex items-center justify-between gap-3 rounded-md border border-[color:var(--hairline-soft)] px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{title}</p>
                  <p className="text-xs text-muted-foreground">
                    Updated a moment ago
                  </p>
                </div>
                <div className="h-2 w-2 rounded-full bg-emerald-500" />
              </div>
            ))}
          </div>
          <div className="space-y-3 rounded-2xl bg-[color:var(--vellum)] backdrop-blur-xl saturate-105 shadow-[var(--shadow-hairline)] p-4">
            <h3 className="text-xs font-medium text-muted-foreground">Inbox</h3>
            {[
              '3 agent replies need review',
              '2 connection failures need fixes',
              '1 blocked issue needs a human',
            ].map((item) => (
              <div
                key={item}
                className="rounded-md border border-[color:var(--hairline-soft)] px-3 py-2 text-sm"
              >
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function DashboardPageSkeleton() {
  const fixture = <DashboardPageFixture />

  return (
    <BoneyardSkeleton
      name={DASHBOARD_PAGE_SKELETON}
      loading
      fixture={fixture}
      className="h-full min-h-0"
    >
      {fixture}
    </BoneyardSkeleton>
  )
}

function DashboardOverviewSection({
  wsId,
  openIssues,
  openConnections,
}: {
  wsId: string
  openIssues: () => void
  openConnections: () => void
}) {
  const { data } = useSuspenseQuery(dashboardOverviewOptions(wsId))
  const hasAgents = data.summary.agentCount > 0

  return (
    <>
      {!hasAgents ? (
        <Alert className="border-warning/30 bg-warning/5 text-warning">
          <Bot />
          <AlertTitle className="text-warning">You have no agents.</AlertTitle>
          <AlertDescription>
            <Button
              variant="link"
              size="sm"
              onClick={openConnections}
              className="h-auto p-0 text-warning underline underline-offset-2 hover:text-warning/80"
            >
              Set one up
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-1 sm:gap-2 xl:grid-cols-4">
        <MetricCard
          icon={CircleDot}
          value={data.summary.openIssues}
          label="Open Work"
          onClick={openIssues}
          description={
            <span>
              {data.summary.totalIssues} total, {data.summary.completedIssues}{' '}
              done
            </span>
          }
        />
        <MetricCard
          icon={ShieldAlert}
          value={data.summary.blockedIssues}
          label="Blocked"
          onClick={openIssues}
          description={
            <span>
              {data.summary.blockedIssues === 0
                ? 'Nothing stuck right now'
                : 'Needs a human to unblock'}
            </span>
          }
        />
        <MetricCard
          icon={Bot}
          value={data.summary.agentCount}
          label="Agents"
          description={<span>{data.summary.skillCount} skills available</span>}
        />
        <MetricCard
          icon={Link2}
          value={data.summary.connectedCount}
          label="Connected Apps"
          onClick={openConnections}
          description={
            <span>
              {data.summary.connectionCount - data.summary.connectedCount}{' '}
              pending
            </span>
          }
        />
      </div>
    </>
  )
}

function DashboardChartsSection({ wsId }: { wsId: string }) {
  const { data } = useSuspenseQuery(dashboardDistributionOptions(wsId))
  const statusBuckets = useMemo(
    () => data.issueStatus.filter((entry) => entry.value > 0),
    [data.issueStatus],
  )
  const priorityBuckets = useMemo(
    () => data.issuePriority.filter((entry) => entry.value > 0),
    [data.issuePriority],
  )

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <ChartCard
        title="Issues by Status"
        subtitle={`${data.summary.totalIssues} total`}
      >
        <DistributionBars entries={statusBuckets} emptyLabel="No issues yet" />
      </ChartCard>
      <ChartCard
        title="Issues by Priority"
        subtitle={`${data.summary.openIssues} open`}
      >
        <DistributionBars
          entries={priorityBuckets}
          emptyLabel="No issues yet"
        />
      </ChartCard>
    </div>
  )
}

function DashboardActivitySection({
  wsId,
  openInbox,
  openIssues,
  openIssueDetail,
}: {
  wsId: string
  openInbox: () => void
  openIssues: () => void
  openIssueDetail: (issue: { id: string; title: string }) => void
}) {
  const { data } = useSuspenseQuery(dashboardActivityOptions(wsId))

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="min-w-0">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[11px] font-medium uppercase tracking-[0.16em] text-[color:var(--gravel)]">
            Recent Activity
          </h3>
          {data.unreadCount > 0 ? (
            <Button
              variant="link"
              size="sm"
              onClick={openInbox}
              className="h-auto p-0 text-xs text-muted-foreground"
            >
              {data.unreadCount} in inbox
            </Button>
          ) : null}
        </div>
        {data.inbox.length === 0 ? (
          <Empty className="border p-4">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <InboxIcon />
              </EmptyMedia>
              <EmptyTitle>Inbox is clear</EmptyTitle>
              <EmptyDescription>You're all caught up.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="divide-y divide-[color:var(--hairline-soft)] overflow-hidden rounded-2xl bg-[color:var(--vellum)] backdrop-blur-xl saturate-105 shadow-[var(--shadow-hairline)]">
            {data.inbox.map((item) => (
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
                      {' '}
                      - {item.type.replaceAll('_', ' ')}
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
          <h3 className="text-[11px] font-medium uppercase tracking-[0.16em] text-[color:var(--gravel)]">
            Recent Tasks
          </h3>
          <Button
            variant="link"
            size="sm"
            onClick={openIssues}
            className="h-auto p-0 text-xs text-muted-foreground"
          >
            View all
          </Button>
        </div>
        {data.recentIssues.length === 0 ? (
          <Empty className="border p-4">
            <EmptyHeader>
              <EmptyTitle>No tasks yet</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="divide-y divide-[color:var(--hairline-soft)] overflow-hidden rounded-2xl bg-[color:var(--vellum)] backdrop-blur-xl saturate-105 shadow-[var(--shadow-hairline)]">
            {data.recentIssues.slice(0, 10).map((issue) => (
              <button
                key={issue.id}
                type="button"
                onClick={() => openIssueDetail(issue)}
                className="block w-full cursor-pointer px-4 py-3 text-left text-sm transition-colors hover:bg-accent/50"
              >
                <div className="flex items-center gap-3">
                  <StatusIcon status={issue.status} className="h-3.5 w-3.5" />
                  <PriorityIcon
                    priority={issue.priority}
                    className="h-3.5 w-3.5"
                  />
                  <span className="min-w-0 flex-1 truncate">{issue.title}</span>
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
  )
}

function DashboardResourcesSection({
  wsId,
  openConnections,
}: {
  wsId: string
  openConnections: () => void
}) {
  const { data } = useSuspenseQuery(dashboardResourcesOptions(wsId))

  if (data.agents.length === 0 && data.connections.length === 0) {
    return null
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {data.agents.length > 0 ? (
        <div className="min-w-0">
          <h3 className="mb-3 text-[11px] font-medium uppercase tracking-[0.16em] text-[color:var(--gravel)]">
            Agents
          </h3>
          <div className="divide-y divide-[color:var(--hairline-soft)] overflow-hidden rounded-2xl bg-[color:var(--vellum)] backdrop-blur-xl saturate-105 shadow-[var(--shadow-hairline)]">
            {data.agents.map((agent) => (
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

      {data.connections.length > 0 ? (
        <div className="min-w-0">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-[11px] font-medium uppercase tracking-[0.16em] text-[color:var(--gravel)]">
              Connections
            </h3>
            <Button
              variant="link"
              size="sm"
              onClick={openConnections}
              className="h-auto p-0 text-xs text-muted-foreground"
            >
              Manage
            </Button>
          </div>
          <div className="divide-y divide-[color:var(--hairline-soft)] overflow-hidden rounded-2xl bg-[color:var(--vellum)] backdrop-blur-xl saturate-105 shadow-[var(--shadow-hairline)]">
            {data.connections.map((connection) => {
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
  )
}

export function DashboardPage() {
  const wsId = useWorkspaceId()
  const dock = useWorkspaceDock()

  const openIssues = useCallback(
    () => dock?.openPanel({ kind: 'issues', title: 'Tasks' }),
    [dock],
  )
  const openInbox = useCallback(
    () => dock?.openPanel({ kind: 'inbox', title: 'Inbox' }),
    [dock],
  )
  const openConnections = useCallback(
    () => dock?.openPanel({ kind: 'capabilities', title: 'Connections' }),
    [dock],
  )
  const openIssueDetail = useCallback(
    (issue: { id: string; title: string }) =>
      dock?.openPanel({
        kind: 'issue-detail',
        title: issue.title,
        entityId: issue.id,
      }),
    [dock],
  )

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-[1360px] space-y-6 px-6 py-6">
        <DashboardSectionBoundary fallback={<DashboardMetricGridFallback />}>
          <DashboardOverviewSection
            wsId={wsId}
            openIssues={openIssues}
            openConnections={openConnections}
          />
        </DashboardSectionBoundary>

        <DashboardSectionBoundary fallback={<DashboardChartSectionFallback />}>
          <DashboardChartsSection wsId={wsId} />
        </DashboardSectionBoundary>

        <DashboardSectionBoundary
          fallback={
            <div className="grid gap-4 md:grid-cols-2">
              <DashboardListSectionFallback title="Recent Activity" />
              <DashboardListSectionFallback title="Recent Tasks" />
            </div>
          }
        >
          <DashboardActivitySection
            wsId={wsId}
            openInbox={openInbox}
            openIssues={openIssues}
            openIssueDetail={openIssueDetail}
          />
        </DashboardSectionBoundary>

        <DashboardSectionBoundary
          fallback={
            <div className="grid gap-4 md:grid-cols-2">
              <DashboardResourceSectionFallback title="Agents" />
              <DashboardResourceSectionFallback title="Connections" />
            </div>
          }
        >
          <DashboardResourcesSection
            wsId={wsId}
            openConnections={openConnections}
          />
        </DashboardSectionBoundary>
      </div>
    </div>
  )
}
