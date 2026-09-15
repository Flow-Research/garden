import { Suspense, useMemo } from 'react'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import {
  BookOpen,
  Info,
  Plus,
  Robot,
} from '@phosphor-icons/react'
import { Button } from '@garden/ui/components/ui/button'
import { Skeleton } from '@garden/ui/components/ui/skeleton'
import { cn } from '@garden/ui/lib/utils'
import { useAuthStore } from '@garden/app-state/auth'
import { useWorkspaceId } from '@garden/app-state/hooks'
import { useSurfaceNavigation } from '@/features/navigation/use-surface-navigation'
import { agentListOptions, skillListOptions } from '@/lib/workspace/queries'
import { homeSnapshotOptions } from '../home.queries'

/**
 * Home surface (Penpot "↪︎ Home", 2026-09). Replaces the old metrics dashboard:
 * welcome header + points pill, member/task/points stat cards, top skills &
 * agents panels, and a platform-usage section. Skills/agents read the
 * shell-warmed list caches; counts/usage come from the home snapshot server fn.
 */

const numberFormat = new Intl.NumberFormat('en-US')
const nairaFormat = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  minimumFractionDigits: 2,
})
const nairaWholeFormat = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  maximumFractionDigits: 0,
})
const eyebrowDateFormat = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: '2-digit',
  year: 'numeric',
})

/** Penpot dates use ordinals ("MONDAY, APRIL 03RD, 2025" / "Monday, April
 * 03rd, 2025"); Intl has no ordinal support, so suffix the padded day. */
function ordinalize(formatted: string) {
  return formatted.replace(/\b(\d{2})\b/, (_, day: string) => {
    const n = Number.parseInt(day, 10)
    const suffix =
      n % 10 === 1 && n !== 11
        ? 'st'
        : n % 10 === 2 && n !== 12
          ? 'nd'
          : n % 10 === 3 && n !== 13
            ? 'rd'
            : 'th'
    return `${day}${suffix}`
  })
}

function formatNumber(value: number) {
  return numberFormat.format(value)
}

/** "23 (45%)" — share of total, 0 when total is 0. */
function sharePercent(value: number, total: number) {
  if (total <= 0) return 0
  return Math.round((value / total) * 100)
}

function PointsPill({ points, nairaValue }: { points: number; nairaValue: number }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-[var(--radius-lg)] border border-border bg-background-main-default px-2 py-1.5 shadow-[var(--shadow-hairline)]">
      <span className="inline-flex items-center rounded-[var(--radius-md)] bg-background-brand-default px-2.5 py-1 text-xs font-medium text-text-neutral-on-neutral">
        {formatNumber(points)} Points
      </span>
      <span className="h-4 w-px bg-border" aria-hidden="true" />
      <span className="pr-1 text-xs font-medium tabular-nums text-text-neutral-default">
        {nairaFormat.format(nairaValue)}
      </span>
    </div>
  )
}

function StatCard({
  label,
  value,
  actionLabel,
  onAction,
}: {
  label: string
  value: number
  actionLabel: string
  onAction?: () => void
}) {
  const disabled = !onAction || value === 0
  return (
    <div className="rounded-2xl border border-border bg-background-main-default p-5 shadow-[var(--shadow-hairline)]">
      <p className="text-sm text-text-secondary">{label}</p>
      <div className="mt-3 flex items-end justify-between gap-3">
        <p className="heading-medium tabular-nums leading-none text-text-neutral-default">
          {formatNumber(value)}
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={onAction}
        >
          {actionLabel}
        </Button>
      </div>
    </div>
  )
}

function ListPanelRow({
  icon,
  name,
  description,
  onView,
}: {
  icon: React.ReactNode
  name: string
  description: string
  onView: () => void
}) {
  return (
    <div className="flex items-center gap-4 py-3">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-background-main-default text-text-neutral-secondary shadow-[var(--shadow-hairline)]">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-text-neutral-default">
          {name}
        </p>
        <p className="truncate text-xs text-text-secondary">{description}</p>
      </div>
      <Button variant="outline" size="sm" onClick={onView}>
        View
      </Button>
    </div>
  )
}

function ListPanelEmpty({
  icon,
  title,
  actionLabel,
  onAction,
}: {
  icon: React.ReactNode
  title: string
  actionLabel: string
  onAction: () => void
}) {
  return (
    <div className="flex min-h-[280px] flex-col items-center justify-center gap-4 py-8 text-center">
      <div className="text-text-neutral-default [&_svg]:size-7">{icon}</div>
      <p className="text-sm font-medium text-text-neutral-default">{title}</p>
      <Button variant="outline" size="sm" onClick={onAction}>
        <Plus />
        {actionLabel}
      </Button>
    </div>
  )
}

function ListPanel({
  title,
  count,
  children,
}: {
  title: string
  count: number
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl bg-background-main-secondary p-4">
      <header className="flex items-center justify-between px-1 pt-1">
        <h3 className="text-sm text-text-secondary">{title}</h3>
        <span className="text-lg font-medium tabular-nums text-text-neutral-default">
          {formatNumber(count)}
        </span>
      </header>
      <div className="mt-2">{children}</div>
    </section>
  )
}

function UsageBarRow({
  label,
  value,
  total,
  color,
}: {
  label: string
  value: number
  total: number
  color: string
}) {
  const pct = sharePercent(value, total)
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm text-text-neutral-default">
          {label}
          <Info className="size-3 text-text-neutral-tertiary" />
        </span>
        <span className="text-sm tabular-nums text-text-neutral-default">
          {formatNumber(value)} ({pct}%)
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-background-main-tertiary">
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  )
}

function SpendRow({
  label,
  color,
  amountNaira,
  total,
}: {
  label: string
  color: string
  amountNaira: number
  total: number
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-background-main-default px-3 py-2.5 shadow-[var(--shadow-hairline)]">
      <span className="flex items-center gap-3 text-sm text-text-neutral-default">
        <span
          className="size-3 shrink-0 rounded-[4px]"
          style={{ backgroundColor: color }}
        />
        {label}
      </span>
      <span className="text-sm tabular-nums text-text-neutral-default">
        {nairaWholeFormat.format(amountNaira)} ({sharePercent(amountNaira, total)}
        %)
      </span>
    </div>
  )
}

function UsageCard({
  title,
  dateLabel,
  totalLabel,
  totalValue,
  children,
}: {
  title: string
  dateLabel: string
  totalLabel: string
  totalValue: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl bg-background-main-secondary p-5">
      <header>
        <h3 className="text-lg font-semibold text-text-neutral-default">
          {title}
        </h3>
        <p className="text-xs text-text-secondary">{dateLabel}</p>
      </header>
      <div className="mt-6 flex items-baseline justify-between gap-3">
        <span className="text-sm text-text-secondary">{totalLabel}</span>
        <span className="text-xl font-semibold tabular-nums text-text-neutral-default">
          {totalValue}
        </span>
      </div>
      <div className="mt-6 space-y-4">{children}</div>
    </section>
  )
}

function HomeSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[1280px] space-y-6 px-8 py-10">
      <div className="space-y-2">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-96" />
      </div>
      <div className="grid grid-cols-3 gap-3.5">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3.5">
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-72 rounded-2xl" />
        ))}
      </div>
    </div>
  )
}

const TOKEN_BAR_COLORS = {
  input: 'var(--background-brand-default)',
  output: 'var(--yellow-500)',
  reasoning: 'var(--red-500)',
} as const

function HomeContent() {
  const wsId = useWorkspaceId()
  const user = useAuthStore((state) => state.user)
  const { openSkill, openAgent, navigate } = useSurfaceNavigation()

  const { data: snapshot } = useSuspenseQuery(homeSnapshotOptions(wsId))
  const skillsQuery = useQuery(skillListOptions(wsId))
  const agentsQuery = useQuery(agentListOptions(wsId))

  const skills = useMemo(() => skillsQuery.data ?? [], [skillsQuery.data])
  const agents = useMemo(
    () =>
      (agentsQuery.data ?? []).filter(
        (agent) => agent.archived_at == null,
      ),
    [agentsQuery.data],
  )

  const firstName = user?.name?.split(' ')[0] ?? 'there'
  const now = new Date()
  const eyebrowDate = ordinalize(eyebrowDateFormat.format(now)).toUpperCase()
  const cardDate = ordinalize(eyebrowDateFormat.format(now))

  const usageTotal = snapshot.usage.totalTokens
  const spendTotal = snapshot.spend.totalSpendNaira

  return (
    <div className="mx-auto w-full max-w-[1280px] space-y-6 px-8 py-10">
      <div className="flex items-start justify-between gap-6">
        <div className="space-y-1">
          <p className="caption text-text-secondary">{eyebrowDate}</p>
          <h1 className="heading-small text-text-neutral-default">
            Welcome, {firstName}!
          </h1>
          <p className="text-sm text-text-secondary">
            Create, manage, and monitor intelligent agents built to handle
            specific tasks.
          </p>
        </div>
        <PointsPill
          points={snapshot.wallet.points}
          nairaValue={snapshot.wallet.nairaValue}
        />
      </div>

      <div className="grid grid-cols-3 gap-3.5">
        <StatCard
          label="Total members"
          value={snapshot.stats.memberCount}
          actionLabel="View members"
          onAction={() => void navigate({ to: '/teams' })}
        />
        <StatCard
          label="Total Assigned Tasks"
          value={snapshot.stats.assignedTaskCount}
          actionLabel="View tasks"
          onAction={() => void navigate({ to: '/tasks' })}
        />
        <StatCard
          label="Total Points"
          value={snapshot.stats.totalPoints}
          actionLabel="See points"
        />
      </div>

      <div className="grid grid-cols-2 gap-3.5">
        <ListPanel title="All Skills" count={skills.length}>
          {skills.length === 0 ? (
            <ListPanelEmpty
              icon={<BookOpen />}
              title="No skills"
              actionLabel="Create a skill"
              onAction={() => void navigate({ to: '/skills' })}
            />
          ) : (
            skills.slice(0, 3).map((skill) => (
              <ListPanelRow
                key={skill.id}
                icon={<BookOpen className="size-5" />}
                name={skill.name}
                description={skill.description}
                onView={() => openSkill(skill.id)}
              />
            ))
          )}
        </ListPanel>

        <ListPanel title="All Agents" count={agents.length}>
          {agents.length === 0 ? (
            <ListPanelEmpty
              icon={<Robot />}
              title="No agents"
              actionLabel="Create an agent"
              onAction={() => void navigate({ to: '/agents' })}
            />
          ) : (
            agents.slice(0, 3).map((agent) => (
              <ListPanelRow
                key={agent.id}
                icon={<Robot className="size-5" />}
                name={agent.name}
                description={agent.description}
                onView={() => openAgent({ id: agent.id })}
              />
            ))
          )}
        </ListPanel>
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-text-neutral-default">
          Platform Usage
        </h2>
        <div className="grid grid-cols-2 gap-3.5">
          <UsageCard
            title="Token Usage"
            dateLabel={cardDate}
            totalLabel="Total Token"
            totalValue={formatNumber(usageTotal)}
          >
            <UsageBarRow
              label="Input Tokens"
              value={snapshot.usage.inputTokens}
              total={usageTotal}
              color={TOKEN_BAR_COLORS.input}
            />
            <UsageBarRow
              label="Output Tokens"
              value={snapshot.usage.outputTokens}
              total={usageTotal}
              color={TOKEN_BAR_COLORS.output}
            />
            <UsageBarRow
              label="Reasoning Tokens"
              value={snapshot.usage.reasoningTokens}
              total={usageTotal}
              color={TOKEN_BAR_COLORS.reasoning}
            />
          </UsageCard>

          <UsageCard
            title="Spend Breakdown"
            dateLabel={cardDate}
            totalLabel="Total Spend Used"
            totalValue={formatNumber(spendTotal)}
          >
            {snapshot.spend.rows.map((row) => (
              <SpendRow
                key={row.key}
                label={row.label}
                color={row.color}
                amountNaira={row.amountNaira}
                total={spendTotal}
              />
            ))}
          </UsageCard>
        </div>
      </div>
    </div>
  )
}

export function HomePage() {
  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <Suspense fallback={<HomeSkeleton />}>
        <HomeContent />
      </Suspense>
    </div>
  )
}
