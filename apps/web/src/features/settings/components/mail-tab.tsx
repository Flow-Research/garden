/**
 * MODIFIED OPENSHIP SOURCE: the day-2 admin shell, horizontal tab bar,
 * overview hero, stats rail, and quick actions mechanically adapt OpenShip's
 * MailAdminPanel and OverviewTab at commit
 * 738946188e7c329477a4bbcf9c58dc1451393798 (Apache-2.0). Garden retains its
 * Cloudflare Agentic Inbox + Zero settings hierarchy and first-class
 * human/agent model. See docs/architecture/garden-mail-ui-sources.md and
 * THIRD_PARTY_NOTICES.md.
 */

import { useState } from 'react'
import {
  ArrowRight,
  AtSign,
  Bot,
  Globe2,
  Inbox,
  LayoutDashboard,
  Mail,
  ShieldCheck,
  UsersRound,
  AlertCircle,
  type LucideIcon,
} from 'lucide-react'
import { useWorkspaceId } from '@garden/app-state/hooks'
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@garden/ui/components/ui/alert'
import { Button } from '@garden/ui/components/ui/button'
import { Badge } from '@garden/ui/components/ui/badge'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@garden/ui/components/ui/empty'
import { Skeleton } from '@garden/ui/components/ui/skeleton'
import type {
  ActiveMailSettingsController,
  MailSettingsController,
} from '../mail-settings-controller'
import { useMailSettingsController } from '../mail-settings-controller'
import { MailDomainSettings } from './mail-domain-settings'
import {
  MailMailboxSettings,
  type MailMailboxSettingsView,
} from './mail-mailbox-settings'
import { MailSettingsCard } from './mail-settings-card'
import { resolveMailSettingsView } from '../mail-settings-view'

type MailAdminTab = 'overview' | 'domains' | MailMailboxSettingsView

type MailAdminTabDefinition = {
  value: MailAdminTab
  label: string
  icon: LucideIcon
}

const mailAdminTabs: readonly MailAdminTabDefinition[] = [
  { value: 'overview', label: 'Overview', icon: LayoutDashboard },
  { value: 'domains', label: 'Domains', icon: Globe2 },
  { value: 'mailboxes', label: 'Mailboxes', icon: Inbox },
  { value: 'addresses', label: 'Addresses', icon: AtSign },
  { value: 'access', label: 'Access', icon: UsersRound },
]

function MailSettingsLoading() {
  return (
    <div aria-label="Loading mail settings" className="space-y-12">
      {[0, 1].map((section) => (
        <section key={section} className="space-y-5">
          <div className="space-y-2">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
          <div className="overflow-hidden rounded-xl border">
            {[0, 1].map((row) => (
              <div key={row} className="flex gap-4 px-5 py-4 [&+&]:border-t">
                <Skeleton className="size-10 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-64 max-w-full" />
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

/**
 * Settings composition boundary. The default controller intentionally reports
 * unavailable until an authenticated workspace RPC is supplied; the UI never
 * fills missing provisioning data with demo domains, actors, or mailboxes.
 */
export function MailTab({
  controller,
}: {
  controller?: MailSettingsController
}) {
  return controller ? (
    <MailTabContent controller={controller} />
  ) : (
    <ConnectedMailTab />
  )
}

function ConnectedMailTab() {
  const workspaceId = useWorkspaceId()
  const controller = useMailSettingsController(workspaceId)
  return <MailTabContent controller={controller} />
}

function MailTabContent({
  controller,
}: {
  controller: MailSettingsController
}) {
  const activeController = controller

  if (activeController.status === 'loading') return <MailSettingsLoading />

  if (activeController.status === 'unavailable') {
    return (
      <Empty className="min-h-80 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Mail />
          </EmptyMedia>
          <EmptyTitle>Mail administration is not connected</EmptyTitle>
          <EmptyDescription>{activeController.reason}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  if (activeController.status === 'error') {
    return (
      <Empty className="min-h-80 border">
        <EmptyHeader>
          <EmptyMedia variant="icon" className="text-destructive">
            <AlertCircle />
          </EmptyMedia>
          <EmptyTitle>Mail settings could not be loaded</EmptyTitle>
          <EmptyDescription>{activeController.message}</EmptyDescription>
          {activeController.retry ? (
            <Button
              variant="outline"
              size="sm"
              onClick={activeController.retry}
            >
              Try again
            </Button>
          ) : null}
        </EmptyHeader>
      </Empty>
    )
  }

  const view = resolveMailSettingsView(activeController)

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-lg font-semibold">Mail</h1>
        <p className="text-sm text-muted-foreground">
          Company domains and collaborative mailboxes for people and agents.
        </p>
      </header>
      {!activeController.canManage ? (
        <Alert>
          <ShieldCheck />
          <AlertTitle>View only</AlertTitle>
          <AlertDescription>
            Workspace administrators manage domains, mailboxes, and access.
          </AlertDescription>
        </Alert>
      ) : null}
      {view === 'setup' ? (
        <MailDomainSettings controller={activeController} />
      ) : (
        <MailAdminPanel controller={activeController} />
      )}
    </div>
  )
}

/** OpenShip-derived tab shell keeps one day-2 mail administration view active. */
function MailAdminPanel({
  controller,
}: {
  controller: ActiveMailSettingsController
}) {
  const [activeTab, setActiveTab] = useState<MailAdminTab>('overview')

  return (
    <div className="space-y-6">
      <MailAdminTabBar active={activeTab} onChange={setActiveTab} />
      {activeTab === 'overview' ? (
        <MailOverview controller={controller} onNavigate={setActiveTab} />
      ) : activeTab === 'domains' ? (
        <MailDomainSettings controller={controller} />
      ) : (
        <MailMailboxSettings controller={controller} view={activeTab} />
      )}
    </div>
  )
}

/** Horizontal, scrollable admin navigation adapted from OpenShip's TabBar. */
function MailAdminTabBar({
  active,
  onChange,
}: {
  active: MailAdminTab
  onChange: (tab: MailAdminTab) => void
}) {
  return (
    <nav
      aria-label="Mail administration"
      className="flex items-center gap-1 overflow-x-auto border-b"
    >
      {mailAdminTabs.map((tab) => {
        const Icon = tab.icon
        const selected = tab.value === active
        return (
          <button
            key={tab.value}
            type="button"
            aria-current={selected ? 'page' : undefined}
            onClick={() => onChange(tab.value)}
            className={`relative inline-flex items-center gap-2 whitespace-nowrap px-4 py-2.5 text-sm font-medium transition-colors ${
              selected
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground/80'
            }`}
          >
            <Icon className="size-4" />
            {tab.label}
            {selected ? (
              <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-primary" />
            ) : null}
          </button>
        )
      })}
    </nav>
  )
}

/** First day-2 view: workspace identity, operational counts, and direct tasks. */
function MailOverview({
  controller,
  onNavigate,
}: {
  controller: ActiveMailSettingsController
  onNavigate: (tab: MailAdminTab) => void
}) {
  const primaryDomain =
    controller.domains.find((domain) => domain.status === 'active') ??
    controller.domains[0]
  const activeDomains = controller.domains.filter(
    (domain) => domain.status === 'active',
  ).length
  const activeMailboxes = controller.mailboxes.filter(
    (mailbox) => mailbox.status === 'active',
  ).length
  const addressCount = controller.mailboxes.reduce(
    (count, mailbox) => count + mailbox.addresses.length,
    0,
  )
  const agentAccessCount = controller.mailboxes.reduce(
    (count, mailbox) =>
      count +
      mailbox.access.filter((access) => access.actor.type === 'agent').length,
    0,
  )

  if (!primaryDomain) return null

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_240px]">
      <div className="min-w-0 space-y-5">
        <MailSettingsCard
          title="Mail workspace"
          description="One shared mail system for people and agents."
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">
                <Mail className="size-5 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Primary domain
                </p>
                <p className="truncate text-lg font-semibold">
                  {primaryDomain.name}
                </p>
              </div>
            </div>
            <Badge
              variant={
                primaryDomain.status === 'failed' ? 'destructive' : 'secondary'
              }
            >
              {primaryDomain.status === 'active'
                ? 'Active'
                : primaryDomain.status === 'pending_verification'
                  ? 'Pending verification'
                  : primaryDomain.status === 'suspended'
                    ? 'Suspended'
                    : 'Needs attention'}
            </Badge>
          </div>
          <div className="mt-5 grid gap-2 sm:grid-cols-3">
            <Capability
              enabled={primaryDomain.sendingEnabled}
              label="Sending"
            />
            <Capability
              enabled={primaryDomain.routingEnabled}
              label="Routing"
            />
            <Capability
              enabled={primaryDomain.catchAllEnabled}
              label="Catch-all"
            />
          </div>
        </MailSettingsCard>

        <MailSettingsCard
          title="Quick actions"
          description="Go directly to common mail administration tasks."
        >
          <div className="divide-y rounded-lg border">
            <QuickAction
              icon={Globe2}
              label="Manage company domains"
              onClick={() => onNavigate('domains')}
            />
            <QuickAction
              icon={Inbox}
              label="Create or review mailboxes"
              onClick={() => onNavigate('mailboxes')}
            />
            <QuickAction
              icon={Bot}
              label="Manage human and agent access"
              onClick={() => onNavigate('access')}
            />
          </div>
        </MailSettingsCard>
      </div>

      <MailSettingsCard title="Mail at a glance" className="self-start">
        <dl className="space-y-4">
          <StatRow
            icon={Globe2}
            label="Active domains"
            value={`${activeDomains}/${controller.domains.length}`}
          />
          <StatRow
            icon={Inbox}
            label="Active mailboxes"
            value={`${activeMailboxes}/${controller.mailboxes.length}`}
          />
          <StatRow icon={AtSign} label="Addresses" value={addressCount} />
          <StatRow icon={Bot} label="Agent access" value={agentAccessCount} />
        </dl>
      </MailSettingsCard>
    </div>
  )
}

function Capability({ enabled, label }: { enabled: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
      <span
        className={`size-2 rounded-full ${
          enabled ? 'bg-success' : 'bg-muted-foreground/30'
        }`}
      />
      <span className={enabled ? 'text-foreground' : 'text-muted-foreground'}>
        {label}
      </span>
    </div>
  )
}

function QuickAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-3 px-3 py-3 text-left text-sm transition-colors hover:bg-muted/40"
    >
      <div className="flex size-8 items-center justify-center rounded-lg bg-muted">
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <span className="min-w-0 flex-1 font-medium">{label}</span>
      <ArrowRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </button>
  )
}

function StatRow({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon
  label: string
  value: string | number
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Icon className="size-4 text-muted-foreground" />
        </div>
        <dt className="truncate text-sm text-muted-foreground">{label}</dt>
      </div>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  )
}
