import type { ReactNode } from 'react'
import { Minimize2 } from 'lucide-react'
import { TabNode } from 'flexlayout-react'
import { Button } from '@garden/ui/components/ui/button'
import { InboxPage } from '@/features/inbox'
import { SkillsPage } from '@/features/skills/components'
import { AgentsPage, AgentDetail } from '@/features/agents/components'
import { IssueDetail, IssuesPage } from '@/features/issues/components'
import { AgentInteractionScreen } from '@/features/chat/components/agent-interaction-screen'
import { DashboardPage } from '@/features/dashboard'
import { ConnectionsPage } from '@/features/connections'
import { AutomationDetailPage, AutomationsPage } from '@/features/automations'
import { useRequiredWorkspaceDock } from './context'
import { getTabConfig, toPanelConfig } from './model'
import { panelIcons } from './panel-icons'
import type { BlankPanelChoice, WorkspacePanelConfig } from './types'

const blankPanelChoices: BlankPanelChoice[] = [
  {
    kind: 'dashboard',
    title: 'Dashboard',
    description: 'Home overview and workspace status',
  },
  {
    kind: 'inbox',
    title: 'Inbox',
    description: 'Approvals, mentions, and blockers',
  },
  {
    kind: 'issues',
    title: 'Tasks',
    description: 'Task list and issue detail flow',
  },
  {
    kind: 'automations',
    title: 'Automations',
    description: 'Recurring schedules for agent work',
  },
  {
    kind: 'chat',
    title: 'New Chat',
    description: 'Start a fresh chat tab',
    forceNew: true,
  },
  {
    kind: 'agents',
    title: 'Agents',
    description: 'Manage workspace agents and their skills',
  },
  {
    kind: 'skill-editor',
    title: 'Library',
    description: 'Browse and edit skills',
  },
  {
    kind: 'capabilities',
    title: 'Connections',
    description: 'Open connector setup and status',
  },
]

/** Wraps dock panels so expanded tabsets can expose an in-panel restore control. */
function WorkspacePanelFrame({
  children,
  panelId,
}: {
  children: ReactNode
  panelId: string
}) {
  const dock = useRequiredWorkspaceDock()
  const expanded = dock.isPanelExpanded(panelId)

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      {expanded ? (
        <div className="pointer-events-none absolute top-3 right-3 z-20">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="pointer-events-auto size-7 rounded-none border-0 bg-transparent p-0 shadow-none"
            onClick={() => dock.togglePanelExpanded(panelId)}
            title="Restore split"
          >
            <Minimize2 className="size-4" />
          </Button>
        </div>
      ) : null}
      {children}
    </div>
  )
}

/** Renders the empty New Tab picker and replaces it with the chosen panel. */
function BlankPanel({ node }: { node: TabNode }) {
  const dock = useRequiredWorkspaceDock()

  return (
    <WorkspacePanelFrame panelId={node.getId()}>
      <section className="flex h-full min-h-0 flex-col bg-background">
        <div className="flex items-center justify-end px-3 py-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => dock.closePanel(node.getId())}
          >
            Close tab
          </Button>
        </div>
        <div className="flex flex-1 items-center justify-center px-6 py-8">
          <div className="w-full max-w-3xl">
            <div className="mb-6">
              <p className="text-[11px] font-medium tracking-[0.22em] text-muted-foreground uppercase">
                New Tab
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-foreground">
                Choose what to open
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Pick a surface for this tab.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {blankPanelChoices.map((choice) => {
                const Icon = panelIcons[choice.kind]
                return (
                  <button
                    key={`${choice.kind}:${choice.title}`}
                    type="button"
                    className="flex min-h-28 flex-col items-start rounded-xl border border-border bg-card px-4 py-4 text-left transition-colors hover:border-foreground/20 hover:bg-accent/40"
                    onClick={() => {
                      dock.openPanel(choice, {
                        forceNew: choice.forceNew,
                        targetPanelId: node.getId(),
                        index: 0,
                      })
                      if (choice.forceNew) dock.closePanel(node.getId())
                    }}
                  >
                    <span className="mb-4 text-foreground">
                      <Icon className="size-4" />
                    </span>
                    <span className="text-sm font-medium text-foreground">
                      {choice.title}
                    </span>
                    <span className="mt-1 text-xs leading-5 text-muted-foreground">
                      {choice.description}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </section>
    </WorkspacePanelFrame>
  )
}

/** Keeps panel wrappers consistent while each product surface owns its content. */
function PanelChrome({
  node,
  children,
}: {
  node: TabNode
  children: ReactNode
}) {
  return (
    <WorkspacePanelFrame panelId={node.getId()}>{children}</WorkspacePanelFrame>
  )
}

function IssueDetailPanel({ node, panel }: PanelProps) {
  if (!panel.entityId) {
    return (
      <PanelChrome node={node}>
        <section className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
          Issue details need an issue id.
        </section>
      </PanelChrome>
    )
  }

  return (
    <PanelChrome node={node}>
      <IssueDetail issueId={panel.entityId} />
    </PanelChrome>
  )
}

function AutomationsPanel({ node }: { node: TabNode }) {
  const dock = useRequiredWorkspaceDock()
  return (
    <PanelChrome node={node}>
      <AutomationsPage
        onOpenAutomation={(automation) =>
          dock.openPanel({
            kind: 'automation-detail',
            title: automation.title,
            entityId: automation.id,
          })
        }
      />
    </PanelChrome>
  )
}

function AutomationDetailPanel({ node, panel }: PanelProps) {
  const dock = useRequiredWorkspaceDock()
  if (!panel.entityId) {
    return (
      <PanelChrome node={node}>
        <section className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
          Automation details need an automation id.
        </section>
      </PanelChrome>
    )
  }

  return (
    <PanelChrome node={node}>
      <AutomationDetailPage
        automationId={panel.entityId}
        onBack={() =>
          dock.openPanel({ kind: 'automations', title: 'Automations' })
        }
        onDeleted={() => {
          dock.openPanel({ kind: 'automations', title: 'Automations' })
          dock.closePanel(node.getId())
        }}
      />
    </PanelChrome>
  )
}

function AgentsPanel({ node }: { node: TabNode }) {
  const dock = useRequiredWorkspaceDock()
  return (
    <PanelChrome node={node}>
      <AgentsPage
        onOpenAgent={(agent) =>
          dock.openPanel({
            kind: 'agent-detail',
            title: agent.name,
            entityId: agent.id,
          })
        }
      />
    </PanelChrome>
  )
}

function AgentDetailPanel({ node, panel }: PanelProps) {
  const dock = useRequiredWorkspaceDock()
  if (!panel.entityId) {
    return (
      <PanelChrome node={node}>
        <section className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
          Agent details need an agent id.
        </section>
      </PanelChrome>
    )
  }

  return (
    <PanelChrome node={node}>
      <AgentDetail
        agentId={panel.entityId}
        onOpenSkill={(skillId) =>
          dock.openPanel({
            kind: 'skill-editor',
            title: 'Library',
            entityId: skillId,
          })
        }
      />
    </PanelChrome>
  )
}

function ChatPanel({ node, panel }: PanelProps) {
  const dock = useRequiredWorkspaceDock()
  return (
    <PanelChrome node={node}>
      <AgentInteractionScreen
        className="flex h-full min-h-0 flex-col bg-background"
        panelTitle={panel.title}
        sessionId={panel.entityId ?? null}
        onSessionChange={(session) =>
          dock.updateChatPanelSession(node.getId(), session)
        }
      />
    </PanelChrome>
  )
}

function CapabilitiesPanel({ node, panel }: PanelProps) {
  return (
    <PanelChrome node={node}>
      <ConnectionsPage
        focusedConnectorId={
          panel.entityId as
            | 'gmail'
            | 'google-drive'
            | 'slack'
            | 'github'
            | undefined
        }
      />
    </PanelChrome>
  )
}

type PanelProps = {
  node: TabNode
  panel: WorkspacePanelConfig
}

/** Resolves FlexLayout tab nodes into the Garden product surface they host. */
export function WorkspacePanelFactory({ node }: { node: TabNode }) {
  const panel =
    getTabConfig(node) ?? toPanelConfig({ kind: 'blank', title: 'New Tab' })

  switch (panel.kind) {
    case 'blank':
      return <BlankPanel node={node} />
    case 'dashboard':
      return (
        <PanelChrome node={node}>
          <DashboardPage />
        </PanelChrome>
      )
    case 'inbox':
      return (
        <PanelChrome node={node}>
          <InboxPage />
        </PanelChrome>
      )
    case 'issues':
      return (
        <PanelChrome node={node}>
          <IssuesPage />
        </PanelChrome>
      )
    case 'issue-detail':
      return <IssueDetailPanel node={node} panel={panel} />
    case 'automations':
      return <AutomationsPanel node={node} />
    case 'automation-detail':
      return <AutomationDetailPanel node={node} panel={panel} />
    case 'chat':
      return <ChatPanel node={node} panel={panel} />
    case 'skill-editor':
      return (
        <PanelChrome node={node}>
          <SkillsPage focusedSkillId={panel.entityId} />
        </PanelChrome>
      )
    case 'capabilities':
      return <CapabilitiesPanel node={node} panel={panel} />
    case 'agents':
      return <AgentsPanel node={node} />
    case 'agent-detail':
      return <AgentDetailPanel node={node} panel={panel} />
  }
}
