import { Component, Suspense, useCallback } from 'react'
import {
  useQueryErrorResetBoundary,
  useSuspenseQuery,
} from '@tanstack/react-query'
import {
  Bot,
  Cable,
  CircleDot,
  CircleAlert,
  CircleCheck,
  GitBranch,
  Folder,
  UserRoundPlus,
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
import { useIssueViewStore } from '@garden/app-state/issues/stores/view-store'
import { useIssuesScopeStore } from '@garden/app-state/issues/stores/issues-scope-store'
import { timeAgo } from '@garden/core/format'
import { STATUS_CONFIG } from '@garden/core/issues/config'
import { PriorityIcon, StatusIcon } from '@/features/issues/components'
import { useSurfaceNavigation } from '@/features/navigation/use-surface-navigation'
import {
  dashboardActivityOptions,
  dashboardDistributionOptions,
  dashboardOverviewOptions,
  dashboardResourcesOptions,
} from '../dashboard.queries'
import type { DashboardBucket } from '../dashboard.server'

function connectionIcon(id: string): LucideIcon {
  switch (id) {
    case 'gmail':
      return Mail
    case 'slack':
      return MessageSquareMore
    case 'google-drive':
      return Folder
    case 'github':
      return GitBranch
    default:
      return Cable
  }
}

/**
 * Keep overview metrics compact enough to scan before the charts. The previous
 * 64px values and large radii dominated the page; shared type/radius tokens now
 * give labels, values, and aligned footers distinct roles. See
 * docs/concepts/features/dashboard.md.
 */
function MetricCard({
  icon: Icon,
  value,
  label,
  description,
  onClick,
  warning = false,
  progress,
}: {
  icon: LucideIcon
  value: string | number
  label: string
  description: React.ReactNode
  onClick: () => void
  warning?: boolean
  progress?: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex h-full min-w-0 cursor-pointer flex-col rounded-xl border border-border/50 bg-background bg-linear-to-b from-muted/25 to-muted/25 p-4 text-left transition-colors hover:border-border hover:from-muted/60 hover:to-muted/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:p-5',
        warning &&
          'border-warning/20 from-warning/[0.03] to-warning/[0.03] hover:border-warning/40 hover:from-warning/[0.06] hover:to-warning/[0.06]',
      )}
    >
      <span className="flex min-h-8 w-full items-center justify-between gap-2">
        <span className="text-xs leading-4 font-medium text-muted-foreground transition-colors group-hover:text-foreground sm:text-sm sm:leading-5">
          {label}
        </span>
        <span
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/80 text-muted-foreground sm:size-8',
            warning && 'bg-warning/10 text-text-warning-default',
          )}
        >
          <Icon aria-hidden="true" className="size-4" />
        </span>
      </span>
      <span
        className={cn(
          'mt-3 text-2xl leading-none font-semibold tracking-tight tabular-nums sm:text-3xl sm:leading-none',
          warning && 'text-text-warning-default',
        )}
      >
        {value}
      </span>
      <span className="mt-auto flex w-full flex-col gap-2 pt-4">
        {progress !== undefined ? (
          <span
            className="block h-1 overflow-hidden rounded-full bg-muted"
            role="meter"
            aria-label="Completed work"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span
              className="block h-full rounded-full bg-success"
              style={{ width: `${progress}%` }}
            />
          </span>
        ) : (
          <span
            aria-hidden="true"
            className="block h-1 border-b border-border/40"
          />
        )}
        <span className="min-h-10 text-xs leading-5 text-muted-foreground sm:min-h-5">
          {description}
        </span>
      </span>
    </button>
  )
}

/**
 * Match the compact metric cards across charts and lists. Oversized corners and
 * uppercase labels previously outweighed the content; use shared radius/type
 * tokens and quiet count chips. See docs/concepts/features/dashboard.md.
 */
function DashboardPanel({
  title,
  subtitle,
  action,
  children,
}: {
  title: string
  subtitle?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="min-w-0 rounded-xl border border-border/50 bg-background bg-linear-to-b from-muted/25 to-muted/25 p-4 sm:p-5">
      <div className="mb-3 flex min-h-7 items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {action ??
          (subtitle ? (
            <span className="shrink-0 rounded-md bg-muted/70 px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
              {subtitle}
            </span>
          ) : null)}
      </div>
      {children}
    </section>
  )
}

/** Priority bars use shares of the displayed distribution, rather than its largest bucket. */
function DistributionBars({
  entries,
  emptyLabel,
}: {
  entries: DashboardBucket[]
  emptyLabel: string
}) {
  const total = entries.reduce((sum, entry) => sum + entry.value, 0)
  if (total === 0)
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>
  return (
    <div className="space-y-4 pt-1">
      {entries.map((entry) => {
        const percentage = Math.round((entry.value / total) * 100)
        return (
          <div key={entry.name} className="space-y-1.5">
            <div className="flex items-center gap-3 text-sm leading-5">
              <span className="flex-1 capitalize">{entry.name}</span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {percentage}%
              </span>
              <span className="min-w-6 text-right font-medium tabular-nums">
                {entry.value}
              </span>
            </div>
            <div
              className="h-1 overflow-hidden rounded-full bg-muted"
              aria-hidden="true"
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${(entry.value / total) * 100}%`,
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

/** Cancelled work is listed separately so the status bar agrees with the overview total. */
function StatusDistribution({ entries }: { entries: DashboardBucket[] }) {
  const active = entries.filter((entry) => entry.name !== 'cancelled')
  const cancelled = entries.find((entry) => entry.name === 'cancelled')
  const total = active.reduce((sum, entry) => sum + entry.value, 0)
  return (
    <div>
      {total > 0 ? (
        <div
          className="mb-3 flex h-2 overflow-hidden rounded-full bg-muted"
          aria-hidden="true"
        >
          {active.map((entry) => (
            <div
              key={entry.name}
              className="h-full border-r-2 border-background last:border-0"
              style={{
                width: `${(entry.value / total) * 100}%`,
                backgroundColor: entry.color,
              }}
            />
          ))}
        </div>
      ) : (
        <p className="mb-4 text-sm text-muted-foreground">No issues yet</p>
      )}
      <dl>
        {[...active, ...(cancelled ? [cancelled] : [])].map((entry) => (
          <div
            key={entry.name}
            className={cn(
              'flex items-center justify-between gap-3 py-2 text-sm leading-5',
              entry.name === 'cancelled' &&
                'mt-2 border-t border-dashed border-border/40 pt-3 text-muted-foreground',
            )}
          >
            <dt className="flex min-w-0 items-center gap-2.5">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              <span className="capitalize">
                {entry.name}
                {entry.name === 'cancelled' ? (
                  <span className="normal-case"> · excluded from total</span>
                ) : null}
              </span>
            </dt>
            <dd className="shrink-0 font-medium tabular-nums">{entry.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function SectionPlaceholder({ className }: { className?: string }) {
  return <div className={cn('rounded-md bg-muted/60', className)} />
}

/** Loading cards reserve the new metric heights to avoid a jump on resolution. */
function DashboardMetricGridFallback() {
  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      {Array.from({ length: 4 }, (_, index) => (
        <div
          key={index}
          className="min-w-0 rounded-xl border border-border/50 bg-background bg-linear-to-b from-muted/25 to-muted/25 p-4 sm:p-5"
        >
          <div className="flex h-8 items-center justify-between gap-2">
            <SectionPlaceholder className="h-3 w-20 max-w-full" />
            <SectionPlaceholder className="size-7 shrink-0 sm:size-8" />
          </div>
          <SectionPlaceholder className="mt-3 h-8 w-12 sm:h-10" />
          <SectionPlaceholder className="mt-4 h-1 w-full" />
          <SectionPlaceholder className="mt-2 h-10 w-28 max-w-full sm:h-5" />
        </div>
      ))}
    </div>
  )
}

function DashboardChartSectionFallback() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {['Issues by status', 'Issues by priority'].map((title) => (
        <DashboardPanel key={title} title={title}>
          <div className="min-h-52 space-y-4">
            {Array.from({ length: 5 }, (_, index) => (
              <SectionPlaceholder key={index} className="h-5 w-full" />
            ))}
          </div>
        </DashboardPanel>
      ))}
    </div>
  )
}

function DashboardListSectionFallback({ title }: { title: string }) {
  return (
    <DashboardPanel title={title}>
      <div className="space-y-4 border-t border-border/30 pt-3">
        {Array.from({ length: 3 }, (_, index) => (
          <SectionPlaceholder key={index} className="h-8 w-full" />
        ))}
      </div>
    </DashboardPanel>
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

/** Match the section fallbacks instead of the previous, unrelated inbox fixture. */
export function DashboardPageSkeleton() {
  return (
    <div
      className="h-full min-h-0 overflow-y-auto"
      aria-label="Loading overview"
      aria-busy="true"
    >
      <div className="mx-auto w-full max-w-[1440px] space-y-6 px-4 py-6 sm:px-8 sm:py-8">
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <DashboardMetricGridFallback />
        <DashboardChartSectionFallback />
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <DashboardListSectionFallback title="Recent tasks" />
            <DashboardListSectionFallback title="Recent activity" />
          </div>
          <div className="space-y-4">
            <DashboardListSectionFallback title="Agents" />
            <DashboardListSectionFallback title="Connections" />
          </div>
        </div>
      </div>
    </div>
  )
}

function DashboardOverviewSection({
  wsId,
  openIssues,
  openBlockedIssues,
  openAgents,
  openConnections,
}: {
  wsId: string
  openIssues: () => void
  openBlockedIssues: () => void
  openAgents: () => void
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
              onClick={openAgents}
              className="h-auto p-0 text-warning underline underline-offset-2 hover:text-warning/80"
            >
              Set one up
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <MetricCard
          icon={CircleDot}
          value={data.summary.openIssues}
          label="Open Work"
          progress={
            data.summary.totalIssues > 0
              ? (data.summary.completedIssues / data.summary.totalIssues) * 100
              : 0
          }
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
          warning={data.summary.blockedIssues > 0}
          onClick={openBlockedIssues}
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
          onClick={openAgents}
          description={
            <span>
              {data.summary.skillCount}{' '}
              {data.summary.skillCount === 1 ? 'skill' : 'skills'} available
            </span>
          }
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

/** The reference replaces repeated status bars with a stack and excludes cancelled work.
 * Priority retains the server's all-task scope; docs/concepts/features/dashboard.md records the denominator.
 */
function DashboardChartsSection({ wsId }: { wsId: string }) {
  const { data } = useSuspenseQuery(dashboardDistributionOptions(wsId))
  const statusOrder = [
    'todo',
    'in progress',
    'in review',
    'blocked',
    'done',
    'cancelled',
  ]
  const priorityOrder = ['urgent', 'high', 'medium', 'low', 'none']
  const statusBuckets = [...data.issueStatus].sort(
    (a, b) => statusOrder.indexOf(a.name) - statusOrder.indexOf(b.name),
  )
  const priorityBuckets = data.issuePriority
    .filter((entry) => entry.value > 0)
    .sort(
      (a, b) => priorityOrder.indexOf(a.name) - priorityOrder.indexOf(b.name),
    )

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <DashboardPanel
        title="Issues by status"
        subtitle={`${data.summary.totalIssues} total`}
      >
        <StatusDistribution entries={statusBuckets} />
      </DashboardPanel>
      <DashboardPanel
        title="Issues by priority"
        subtitle={`All ${priorityBuckets.reduce((sum, entry) => sum + entry.value, 0)} tasks`}
      >
        <DistributionBars
          entries={priorityBuckets}
          emptyLabel="No issues yet"
        />
      </DashboardPanel>
    </div>
  )
}

/** Activity used an assignment icon for every event, including failures.
 * Mirror the inbox event vocabulary with distinct symbols; unknown events retain a neutral inbox icon.
 */
function activityIcon(type: string): LucideIcon {
  switch (type) {
    case 'issue_assigned':
    case 'assignee_changed':
    case 'unassigned':
      return UserRoundPlus
    case 'task_failed':
      return CircleAlert
    case 'agent_blocked':
      return ShieldAlert
    case 'task_completed':
    case 'agent_completed':
      return CircleCheck
    case 'new_comment':
    case 'mentioned':
    case 'waiting_for_input':
      return MessageSquareMore
    case 'connector_needed':
      return Cable
    default:
      return InboxIcon
  }
}

/** Stack tasks above activity in the left column while retaining existing inbox/task navigation. */
function DashboardActivitySection({
  wsId,
  openInbox,
  openInboxItem,
  openIssues,
  openIssueDetail,
}: {
  wsId: string
  openInbox: () => void
  openInboxItem: (itemId: string) => void
  openIssues: () => void
  openIssueDetail: (issue: { id: string; title: string }) => void
}) {
  const { data } = useSuspenseQuery(dashboardActivityOptions(wsId))

  return (
    <div className="min-w-0 space-y-4">
      <DashboardPanel
        title="Recent tasks"
        action={
          <Button
            variant="ghost"
            size="sm"
            onClick={openIssues}
            className="-mr-2 h-7 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            View all
          </Button>
        }
      >
        {data.recentIssues.length === 0 ? (
          <Empty className="border-0 py-6">
            <EmptyHeader>
              <EmptyTitle>No tasks yet</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="divide-y divide-border/25 border-t border-border/30">
            {data.recentIssues.map((issue) => (
              <button
                key={issue.id}
                type="button"
                onClick={() => openIssueDetail(issue)}
                className="block w-full cursor-pointer px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              >
                <div className="flex items-center gap-3">
                  <StatusIcon
                    status={issue.status}
                    className="size-4 shrink-0"
                  />
                  <PriorityIcon
                    priority={issue.priority}
                    className="size-4 shrink-0"
                  />
                  <span className="min-w-0 flex-1 truncate" title={issue.title}>
                    {issue.title}
                  </span>
                  <span
                    className={cn(
                      'hidden w-20 shrink-0 text-right text-xs text-muted-foreground sm:block',
                      issue.status === 'blocked' && 'text-text-danger-default',
                    )}
                  >
                    {STATUS_CONFIG[issue.status]?.label ?? issue.status}
                  </span>
                  <span className="w-7 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    {timeAgo(issue.updatedAt, { compact: true })}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </DashboardPanel>
      <DashboardPanel
        title="Recent activity"
        action={
          data.unreadCount > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={openInbox}
              className="-mr-2 h-7 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              {data.unreadCount} in inbox
            </Button>
          ) : undefined
        }
      >
        {data.inbox.length === 0 ? (
          <Empty className="border-0 py-6">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <InboxIcon />
              </EmptyMedia>
              <EmptyTitle>Inbox is clear</EmptyTitle>
              <EmptyDescription>You're all caught up.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="divide-y divide-border/25 border-t border-border/30">
            {data.inbox.map((item) => {
              const Icon = activityIcon(item.type)
              return (
                <button
                  key={item.id}
                  type="button"
                  // Items with no issue (connector prompts, run notices) used to
                  // navigate to /tasks/ with an empty id.
                  onClick={() =>
                    item.issue_id
                      ? openIssueDetail({
                          id: item.issue_id,
                          title: item.title,
                        })
                      : openInboxItem(item.id)
                  }
                  className="block w-full cursor-pointer px-3 py-3 text-left text-sm transition-colors hover:bg-accent/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/80 text-muted-foreground">
                      <Icon aria-hidden="true" className="size-4" />
                    </span>
                    <p className="min-w-0 flex-1">
                      <span
                        className="block truncate font-medium"
                        title={item.title}
                      >
                        {item.title}
                      </span>
                      <span className="block truncate text-xs capitalize text-muted-foreground">
                        {item.type.replaceAll('_', ' ')}
                      </span>
                    </p>
                    <span className="w-7 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                      {timeAgo(item.created_at, { compact: true })}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </DashboardPanel>
    </div>
  )
}

/** Stack resources in the right column with icon tiles and status badges from the dashboard references. */
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
    <div className="min-w-0 space-y-4">
      {data.agents.length > 0 ? (
        <DashboardPanel title="Agents">
          <div className="divide-y divide-border/25 border-t border-border/30">
            {data.agents.map((agent) => (
              <div
                key={agent.id}
                className="flex items-center gap-3 py-3 text-sm"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/80 text-muted-foreground">
                  <Bot className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium" title={agent.name}>
                    {agent.name}
                  </div>
                  <div
                    className="truncate text-xs text-muted-foreground"
                    title={agent.roleTitle ?? undefined}
                  >
                    {agent.roleTitle ?? 'Workspace agent'}
                  </div>
                </div>
                <div className="shrink-0 space-y-1 text-right">
                  <Badge
                    variant="outline"
                    className={cn(
                      'rounded-md border-transparent bg-muted/60 font-normal capitalize text-muted-foreground',
                      agent.status === 'active' && 'bg-success/10 text-success',
                    )}
                  >
                    {agent.status === 'active' ? (
                      <span className="size-1.5 rounded-full bg-success" />
                    ) : null}
                    {agent.status}
                  </Badge>
                  <p className="text-xs tabular-nums text-muted-foreground">
                    {agent.activeIssueCount} active{' '}
                    {agent.activeIssueCount === 1 ? 'task' : 'tasks'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </DashboardPanel>
      ) : null}

      {data.connections.length > 0 ? (
        <DashboardPanel
          title="Connections"
          action={
            <Button
              variant="ghost"
              size="sm"
              onClick={openConnections}
              className="-mr-2 h-7 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              Manage
            </Button>
          }
        >
          <div className="divide-y divide-border/25 border-t border-border/30">
            {data.connections.map((connection) => {
              const Icon = connectionIcon(connection.id)
              return (
                <button
                  key={connection.id}
                  type="button"
                  onClick={openConnections}
                  className="flex w-full cursor-pointer items-center gap-3 py-3 text-left text-sm transition-colors hover:bg-accent/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/80 text-muted-foreground">
                    <Icon className="size-4" />
                  </span>
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
                    className={cn(
                      'rounded-md border-transparent bg-muted/60 font-normal capitalize text-muted-foreground',
                      connection.status === 'connected' &&
                        'bg-success/10 text-success',
                    )}
                  >
                    {connection.status === 'connected' ? (
                      <span className="size-1.5 rounded-full bg-success" />
                    ) : null}
                    {connection.status}
                  </Badge>
                </button>
              )
            })}
          </div>
        </DashboardPanel>
      ) : null}
    </div>
  )
}

export function DashboardPage() {
  const wsId = useWorkspaceId()
  const { openIssue, openConnections, navigate } = useSurfaceNavigation()

  const openIssues = useCallback(
    () => void navigate({ to: '/tasks' }),
    [navigate],
  )
  const openInbox = useCallback(
    () => void navigate({ to: '/inbox' }),
    [navigate],
  )
  const openInboxItem = useCallback(
    (itemId: string) =>
      void navigate({ href: `/inbox?item=${encodeURIComponent(itemId)}` }),
    [navigate],
  )
  const openAgents = useCallback(
    () => void navigate({ to: '/agents' }),
    [navigate],
  )
  // "Blocked" opened the unfiltered list. Its count is workspace-wide, so the
  // scope and the other filters are reset for the list to match it.
  const openBlockedIssues = useCallback(() => {
    useIssuesScopeStore.getState().setScope('all')
    const view = useIssueViewStore.getState()
    view.clearFilters()
    view.toggleStatusFilter('blocked')
    void navigate({ to: '/tasks' })
  }, [navigate])
  const openIssueDetail = useCallback(
    (issue: { id: string; title: string }) =>
      openIssue({ id: issue.id, title: issue.title }),
    [openIssue],
  )

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-[1440px] space-y-6 px-4 py-6 sm:px-8 sm:py-8">
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <DashboardSectionBoundary fallback={<DashboardMetricGridFallback />}>
          <DashboardOverviewSection
            wsId={wsId}
            openIssues={openIssues}
            openBlockedIssues={openBlockedIssues}
            openAgents={openAgents}
            openConnections={openConnections}
          />
        </DashboardSectionBoundary>

        <DashboardSectionBoundary fallback={<DashboardChartSectionFallback />}>
          <DashboardChartsSection wsId={wsId} />
        </DashboardSectionBoundary>

        <div className="grid items-start gap-4 lg:grid-cols-2">
          <DashboardSectionBoundary
            fallback={
              <div className="space-y-4">
                <DashboardListSectionFallback title="Recent tasks" />
                <DashboardListSectionFallback title="Recent activity" />
              </div>
            }
          >
            <DashboardActivitySection
              wsId={wsId}
              openInbox={openInbox}
              openInboxItem={openInboxItem}
              openIssues={openIssues}
              openIssueDetail={openIssueDetail}
            />
          </DashboardSectionBoundary>

          <DashboardSectionBoundary
            fallback={
              <div className="space-y-4">
                <DashboardListSectionFallback title="Agents" />
                <DashboardListSectionFallback title="Connections" />
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
    </div>
  )
}
