import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react'
import { Result } from 'better-result'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { IconMessage2Plus } from '@tabler/icons-react'
import { Bot, Plug, Plus, Search, X, Zap } from 'lucide-react'
import { Icon as IconifyIcon } from '@iconify/react'
import { BrandIcon } from '@garden/ui/components/common/brand-icon'
import type { ConnectorId } from '@garden/connectors/registry'
import { listConnections } from '@/lib/api'
import type { Agent, Skill } from '@garden/core/types'
import {
  agentListOptions,
  skillListOptions,
  workspaceListOptions,
} from '@/lib/workspace/queries'
import {
  useSkillsBrowseStore,
  useSkillEditorStore,
} from '@garden/app-state/skills'
import { FileTree } from '@/features/skills/components/file-tree'
import { Button } from '@garden/ui/components/ui/button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@garden/ui/components/ui/input-group'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@garden/ui/components/ui/sidebar'
import { deduplicateInboxItems, inboxListOptions } from '@/lib/inbox/queries'
import { automationListOptions } from '@/features/automations/queries'
import { useAuthStore } from '@garden/app-state/auth'
import { useWorkspaceStore } from '@garden/app-state/workspace'
import { SearchTrigger } from '@/features/search'
import { ChatSessionExplorer } from '@/features/chat'
import {
  isPendingFirstTurn,
  useAgentSessions,
} from '@/features/chat/use-agent-chat-sessions'
import { useNavigation } from '@/features/navigation'
import { useSettingsDialogStore } from '@/features/settings'
import { NavUser } from '@/components/nav-user'
import {
  useWorkspaceDock,
  type WorkspacePanelKind,
  type WorkspacePanelInput,
} from './workspace-dock'
import { toast } from 'sonner'

type RailContext =
  | 'home'
  | 'chats'
  | 'tasks'
  | 'automations'
  | 'inbox'
  | 'agents'
  | 'skills'
  | 'connections'

type RailItem = {
  id: RailContext
  label: string
  icon: React.ComponentType<{ className?: string }>
  defaultPanel: WorkspacePanelInput
}

type PendingRail = {
  id: RailContext
  from: RailContext
}

const railItems: RailItem[] = [
  {
    id: 'home',
    label: 'Home',
    icon: RailHomeIcon,
    defaultPanel: { kind: 'dashboard', title: 'Dashboard' },
  },
  {
    id: 'chats',
    label: 'Chats',
    icon: RailChatsIcon,
    defaultPanel: { kind: 'chat', title: 'New Chat' },
  },
  {
    id: 'tasks',
    label: 'Tasks',
    icon: HomeTasksIcon,
    defaultPanel: { kind: 'issues', title: 'Tasks' },
  },
  {
    id: 'automations',
    label: 'Automations',
    icon: Zap,
    defaultPanel: { kind: 'automations', title: 'Automations' },
  },
  {
    id: 'inbox',
    label: 'Inbox',
    icon: HomeInboxIcon,
    defaultPanel: { kind: 'inbox', title: 'Inbox' },
  },
  {
    id: 'agents',
    label: 'Agents',
    icon: RailAgentsIcon,
    defaultPanel: { kind: 'agents', title: 'Agents' },
  },
  {
    id: 'skills',
    label: 'Skills',
    icon: RailSkillsIcon,
    defaultPanel: { kind: 'skill-editor', title: 'Library' },
  },
  {
    id: 'connections',
    label: 'Connections',
    icon: RailConnectionsIcon,
    defaultPanel: { kind: 'capabilities', title: 'Connections' },
  },
]

function contextFromPanel(kind: WorkspacePanelKind | null): RailContext {
  switch (kind) {
    case 'chat':
      return 'chats'
    case 'issues':
    case 'issue-detail':
      return 'tasks'
    case 'automations':
    case 'automation-detail':
      return 'automations'
    case 'inbox':
      return 'inbox'
    case 'agents':
    case 'agent-detail':
      return 'agents'
    case 'skill-editor':
      return 'skills'
    case 'capabilities':
      return 'connections'
    case 'blank':
    case 'dashboard':
    default:
      return 'home'
  }
}

function railUsesContextRail(rail: RailContext): boolean {
  return (
    rail === 'chats' ||
    rail === 'skills' ||
    rail === 'agents' ||
    rail === 'connections'
  )
}

function RailHomeIcon({ className }: { className?: string }) {
  return <IconifyIcon icon="hugeicons:home-05" className={className} />
}

function RailChatsIcon({ className }: { className?: string }) {
  return <IconifyIcon icon="hugeicons:bubble-chat" className={className} />
}

function RailAgentsIcon({ className }: { className?: string }) {
  return <IconifyIcon icon="hugeicons:robot-01" className={className} />
}

function RailSkillsIcon({ className }: { className?: string }) {
  return <IconifyIcon icon="hugeicons:book-open-01" className={className} />
}

function RailConnectionsIcon({ className }: { className?: string }) {
  return <IconifyIcon icon="hugeicons:plug-socket" className={className} />
}

function RailSettingsIcon({ className }: { className?: string }) {
  return <IconifyIcon icon="hugeicons:settings-02" className={className} />
}

function HomeTasksIcon({ className }: { className?: string }) {
  return <IconifyIcon icon="ic:sharp-checklist" className={className} />
}

function HomeInboxIcon({ className }: { className?: string }) {
  return (
    <IconifyIcon
      icon="material-symbols:inbox-outline-sharp"
      className={className}
    />
  )
}

function ExplorerSection({ children }: { children: React.ReactNode }) {
  return (
    <SidebarGroup className="px-0 py-1.5">
      <SidebarGroupContent>{children}</SidebarGroupContent>
    </SidebarGroup>
  )
}

function ExplorerActionRow({
  label,
  icon: Icon,
  active = false,
  onClick,
  badge,
}: {
  label: string
  icon: React.ComponentType<{ className?: string }>
  active?: boolean
  onClick: () => void
  badge?: number
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        className="rounded-[7px] px-2.5 transition-all duration-150 data-[active=true]:bg-[color:var(--vellum-heavy)] data-[active=true]:text-[color:var(--ink)] data-[active=true]:font-medium data-[active=true]:shadow-[inset_0_0_0_0.5px_rgba(26,31,28,0.10)] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        onClick={onClick}
      >
        <Icon className="size-4" />
        <span>{label}</span>
      </SidebarMenuButton>
      {typeof badge === 'number' && badge > 0 ? (
        <SidebarMenuBadge>{badge > 99 ? '99+' : badge}</SidebarMenuBadge>
      ) : null}
    </SidebarMenuItem>
  )
}

type WorkspaceSidebarProps = {
  onCreateWorkspace: () => void
}

export function WorkspaceSidebar({ onCreateWorkspace }: WorkspaceSidebarProps) {
  const queryClient = useQueryClient()
  const workspaceSidebar = useSidebar()
  const { replace } = useNavigation()
  const dock = useWorkspaceDock()
  const activePanel = dock?.activePanel ?? null
  const openPanel = useCallback(
    (panel: WorkspacePanelInput) => dock?.openPanel(panel),
    [dock],
  )
  const openContextRail = useCallback(() => {
    workspaceSidebar.setOpen(true)
  }, [workspaceSidebar])
  const closePanel = useCallback(
    (panelId: string) => {
      dock?.closePanel(panelId)
    },
    [dock],
  )
  const { claimWarmSession, sessions } = useAgentSessions()
  const workspace = useWorkspaceStore((state) => state.workspace)
  const clearWorkspace = useWorkspaceStore((state) => state.clearWorkspace)
  const switchWorkspace = useWorkspaceStore((state) => state.switchWorkspace)
  const user = useAuthStore((state) => state.user)
  const logout = useAuthStore((state) => state.logout)
  const openSettingsDialog = useSettingsDialogStore((s) => s.openSettings)
  const activeType = activePanel?.kind ?? null
  const activeEntityId = activePanel?.entityId ?? null
  const activeSession = sessions.find(
    (session) => session.id === activeEntityId,
  )
  const activeIsPendingNewChat =
    activeType === 'chat' && activeSession
      ? isPendingFirstTurn(activeSession)
      : false
  const activeRailId = contextFromPanel(activeType)
  const [pendingRail, setPendingRail] = useState<PendingRail | null>(null)
  const effectiveRailId =
    pendingRail && activeRailId === pendingRail.from
      ? pendingRail.id
      : activeRailId
  const workspaceId = workspace?.id ?? ''
  const workspaceListQuery = useQuery(workspaceListOptions())

  const { data: rawInboxItems = [] } = useQuery({
    ...inboxListOptions(workspaceId),
    enabled: !!workspaceId,
  })
  useQuery({
    ...automationListOptions(workspaceId),
    enabled: !!workspaceId,
  })

  const prefetchRailData = useCallback(
    (item: RailItem) => {
      if (!workspaceId) return

      if (item.id === 'inbox') {
        void queryClient.prefetchQuery(inboxListOptions(workspaceId))
      }

      if (item.id === 'automations') {
        void queryClient.prefetchQuery(automationListOptions(workspaceId))
      }
    },
    [queryClient, workspaceId],
  )

  const inboxItems = useMemo(
    () => deduplicateInboxItems(rawInboxItems).slice(0, 6),
    [rawInboxItems],
  )
  const unreadCount = inboxItems.filter((item) => !item.read).length

  useEffect(() => {
    if (pendingRail && activeRailId !== pendingRail.from) {
      setPendingRail(null)
    }
  }, [activeRailId, pendingRail])

  useLayoutEffect(() => {
    if (!railUsesContextRail(activeRailId) && workspaceSidebar.open) {
      workspaceSidebar.setOpen(false)
    }
  }, [activeRailId, workspaceSidebar])

  const openDashboard = useCallback(() => {
    openPanel({ kind: 'dashboard', title: 'Dashboard' })
  }, [openPanel])

  const openSettings = useCallback(() => {
    openSettingsDialog()
  }, [openSettingsDialog])

  const openRailContext = useCallback(
    (item: RailItem) => {
      prefetchRailData(item)
      const nextUsesContextRail = railUsesContextRail(item.id)
      setPendingRail(
        nextUsesContextRail ? null : { id: item.id, from: activeRailId },
      )
      if (item.id === 'chats') {
        openContextRail()
        const latestThread =
          sessions.find((session) => !isPendingFirstTurn(session)) ?? null
        if (latestThread) {
          openPanel({
            kind: 'chat',
            title: latestThread.title,
            entityId: latestThread.id,
          })
          return
        }

        void Result.tryPromise(() => claimWarmSession()).then((result) => {
          if (Result.isError(result)) {
            setPendingRail(null)
            toast.error(
              result.error instanceof Error
                ? result.error.message
                : 'Failed to start chat',
            )
            return
          }
          openPanel({
            kind: 'chat',
            title: result.value.title,
            entityId: result.value.id,
          })
        })
        return
      }

      if (nextUsesContextRail) {
        openContextRail()
      } else {
        workspaceSidebar.setOpen(false)
      }
      openPanel(item.defaultPanel)
    },
    [
      activeRailId,
      claimWarmSession,
      openContextRail,
      openPanel,
      prefetchRailData,
      sessions,
      workspaceSidebar,
    ],
  )

  const handleSwitchWorkspace = useCallback(
    (nextWorkspace: NonNullable<typeof workspace>) => {
      if (nextWorkspace.id === workspace?.id) return
      void Result.tryPromise(() => switchWorkspace(nextWorkspace)).then(
        (result) =>
          result.tapBoth({
            ok: () => {
              queryClient.invalidateQueries()
              toast.success(`Switched to ${nextWorkspace.name}`)
            },
            err: (error) => {
              toast.error(
                error instanceof Error
                  ? error.message
                  : 'Failed to switch workspace',
              )
            },
          }),
      )
    },
    [queryClient, switchWorkspace, workspace?.id],
  )

  const handleLogout = useCallback(async () => {
    const result = await Result.tryPromise(() => logout())
    if (Result.isError(result)) {
      toast.error(
        result.error instanceof Error
          ? result.error.message
          : 'Failed to sign out',
      )
      return
    }
    queryClient.clear()
    clearWorkspace()
    toast.success('Signed out')
    replace('/login')
  }, [clearWorkspace, logout, queryClient, replace])

  return (
    <Sidebar
      collapsible="icon"
      variant="floating"
      disableTransition
      className="overflow-hidden border-0 [&_[data-slot=sidebar-inner]]:rounded-[14px] [&_[data-slot=sidebar-inner]]:overflow-hidden [&_[data-slot=sidebar-inner]]:backdrop-blur-xl [&_[data-slot=sidebar-inner]]:saturate-110 [&_[data-slot=sidebar-inner]]:shadow-[var(--shadow-hairline)] [&_[data-slot=sidebar-inner]]:ring-0 *:data-[sidebar=sidebar]:flex-row"
    >
      <Sidebar
        collapsible="none"
        className="w-[calc(var(--sidebar-width-icon)+1px)]! shrink-0 bg-transparent"
      >
        <SidebarHeader className="p-0">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                size="lg"
                aria-label={workspace?.name ?? 'Garden'}
                className="!h-12 !w-full !gap-0 !p-0 justify-center !rounded-[8px] group-data-[collapsible=icon]:!h-12 group-data-[collapsible=icon]:!w-full data-[active=true]:!bg-transparent hover:!bg-transparent"
                tooltip={{
                  children: workspace?.name ?? 'Garden',
                  hidden: false,
                }}
                onClick={openDashboard}
              >
                <div className="flex size-8 items-center justify-center rounded-[8px] bg-[color:var(--bone)] text-[color:var(--ink)] shadow-[var(--shadow-hairline)]">
                  <BrandIcon className="size-4" noSpin />
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup className="p-0">
            <SidebarGroupContent>
              <SidebarMenu className="gap-2 py-2">
                {railItems.map((item) => (
                  <SidebarMenuItem
                    key={item.id}
                    className="!flex !justify-center"
                  >
                    <SidebarMenuButton
                      tooltip={{
                        children: item.label,
                        hidden: false,
                      }}
                      aria-label={item.label}
                      isActive={activeRailId === item.id}
                      className="!h-8 !w-8 !gap-0 !p-0 justify-center !rounded-[8px] transition-all duration-150 !text-[color:var(--slate)] data-[active=true]:!bg-[color:var(--vellum-heavy)] data-[active=true]:!text-[color:var(--ink)] data-[active=true]:shadow-[inset_0_0_0_0.5px_rgba(26,31,28,0.10)] hover:!bg-sidebar-accent hover:!text-sidebar-accent-foreground group-data-[collapsible=icon]:!h-8 group-data-[collapsible=icon]:!w-8"
                      onPointerEnter={() => prefetchRailData(item)}
                      onFocus={() => prefetchRailData(item)}
                      onClick={() => openRailContext(item)}
                    >
                      <item.icon className="!size-[20px] shrink-0" />
                    </SidebarMenuButton>
                    {item.id === 'inbox' && unreadCount > 0 ? (
                      <SidebarMenuBadge>
                        {unreadCount > 99 ? '99+' : unreadCount}
                      </SidebarMenuBadge>
                    ) : null}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="p-0">
          <SidebarMenu className="gap-0">
            <SidebarMenuItem className="!flex !justify-center">
              <SidebarMenuButton
                tooltip={{
                  children: 'Settings',
                  hidden: false,
                }}
                aria-label="Settings"
                className="!h-8 !w-8 !gap-0 !p-0 justify-center !rounded-[8px] transition-all duration-150 !text-[color:var(--slate)] hover:!bg-sidebar-accent hover:!text-sidebar-accent-foreground group-data-[collapsible=icon]:!h-8 group-data-[collapsible=icon]:!w-8"
                onClick={openSettings}
              >
                <RailSettingsIcon className="!size-[20px] shrink-0" />
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <NavUser
            user={{
              name: user?.name ?? 'Account',
              email: user?.email ?? 'Signed out',
              avatar: user?.avatar_url ?? null,
            }}
            currentWorkspaceId={workspace?.id ?? null}
            workspaces={workspaceListQuery.data ?? []}
            onAccount={openSettings}
            onCreateWorkspace={onCreateWorkspace}
            onSwitchWorkspace={handleSwitchWorkspace}
            onLogout={() => {
              void handleLogout()
            }}
          />
        </SidebarFooter>
      </Sidebar>

      <Sidebar
        collapsible="none"
        className={
          !railUsesContextRail(effectiveRailId)
            ? 'hidden'
            : 'hidden min-w-0 flex-1 md:flex'
        }
      >
        <SidebarHeader className="p-3">
          <SearchTrigger className="flex-1" />
        </SidebarHeader>

        <SidebarContent>
          {effectiveRailId === 'chats' ? (
            <ExplorerSection>
              <SidebarMenu>
                <ExplorerActionRow
                  label="New Chat"
                  icon={IconMessage2Plus}
                  active={activeIsPendingNewChat}
                  onClick={() => {
                    void Result.tryPromise(() => claimWarmSession()).then(
                      (result) => {
                        if (Result.isError(result)) {
                          toast.error(
                            result.error instanceof Error
                              ? result.error.message
                              : 'Failed to start chat',
                          )
                          return
                        }
                        openPanel({
                          kind: 'chat',
                          title: result.value.title,
                          entityId: result.value.id,
                        })
                      },
                    )
                  }}
                />
              </SidebarMenu>
              <div className="mt-2 border-t border-sidebar-border/70 pt-2">
                <ChatSessionExplorer
                  activeDockSessionId={
                    activeType === 'chat' ? activeEntityId : null
                  }
                  onActivate={(session) => {
                    openPanel({
                      kind: 'chat',
                      title: session.title,
                      entityId: session.id,
                    })
                  }}
                  onArchive={(sessionId) => closePanel(`chat:${sessionId}`)}
                />
              </div>
            </ExplorerSection>
          ) : null}

          {effectiveRailId === 'agents' ? (
            <AgentsExplorer
              workspaceId={workspaceId}
              activeType={activeType}
              activeEntityId={
                activeType === 'agent-detail' ? activeEntityId : null
              }
              onOpenList={() => openPanel({ kind: 'agents', title: 'Agents' })}
              onOpenAgent={(agent) =>
                openPanel({
                  kind: 'agent-detail',
                  title: agent.name,
                  entityId: agent.id,
                })
              }
            />
          ) : null}

          {effectiveRailId === 'skills' ? (
            <SkillsRailExplorer
              workspaceId={workspaceId}
              activeEntityId={
                activeType === 'skill-editor' ? activeEntityId : null
              }
              onOpenSkill={(skill) =>
                openPanel({
                  kind: 'skill-editor',
                  title: 'Library',
                  entityId: skill.id,
                })
              }
              onOpenLibrary={() =>
                openPanel({ kind: 'skill-editor', title: 'Library' })
              }
            />
          ) : null}

          {effectiveRailId === 'connections' ? (
            <ConnectionsExplorer
              activeEntityId={
                activeType === 'capabilities'
                  ? (activeEntityId as ConnectorId | null)
                  : null
              }
              onOpenConnector={(connector) =>
                openPanel({
                  kind: 'capabilities',
                  title: connector.label,
                  entityId: connector.id,
                })
              }
            />
          ) : null}
        </SidebarContent>
      </Sidebar>
    </Sidebar>
  )
}

type ConnectionRowData = {
  id: ConnectorId
  label: string
  status: 'available' | 'connected' | 'degraded' | 'disconnected'
}

type ConnectionsSnapshotLite = {
  connectors: ConnectionRowData[]
}

async function loadConnectionsForSidebar(): Promise<ConnectionsSnapshotLite> {
  const snapshot = await listConnections({ summary: true })
  return { connectors: snapshot.connectors }
}

const CONNECTOR_ROW_ICON: Record<ConnectorId, string | null> = {
  slack: 'logos:slack-icon',
  gmail: 'logos:google-gmail',
  'google-drive': 'logos:google-drive',
  github: 'logos:github-icon',
  'exa-search': 'simple-icons:exa',
}

function ConnectorRowIcon({
  id,
  className,
}: {
  id: ConnectorId
  className?: string
}) {
  const icon = CONNECTOR_ROW_ICON[id]
  if (!icon) return <Plug className={className} />
  return <IconifyIcon icon={icon} className={className} />
}

function connectorDotColor(status: ConnectionRowData['status']) {
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

const AGENT_STATUS_COLOR: Record<Agent['status'], string> = {
  idle: 'bg-zinc-400',
  working: 'bg-emerald-500',
  blocked: 'bg-amber-500',
  error: 'bg-red-500',
  offline: 'bg-zinc-300',
}

function AgentsExplorer({
  workspaceId,
  activeType,
  activeEntityId,
  onOpenList,
  onOpenAgent,
}: {
  workspaceId: string
  activeType: WorkspacePanelKind | null
  activeEntityId: string | null
  onOpenList: () => void
  onOpenAgent: (agent: Agent) => void
}) {
  const agentsQuery = useQuery({
    ...agentListOptions(workspaceId),
    enabled: !!workspaceId,
  })

  const live = useMemo(
    () => (agentsQuery.data ?? []).filter((agent) => !agent.archived_at),
    [agentsQuery.data],
  )

  return (
    <>
      <ExplorerSection>
        <SidebarMenu>
          <ExplorerActionRow
            label="All agents"
            icon={Bot}
            active={activeType === 'agents'}
            onClick={onOpenList}
          />
        </SidebarMenu>
      </ExplorerSection>
      {live.length > 0 ? (
        <ExplorerSection>
          <SidebarMenu>
            {live.map((agent) => {
              const active = activeEntityId === agent.id
              return (
                <SidebarMenuItem key={agent.id}>
                  <SidebarMenuButton
                    isActive={active}
                    className="rounded-[7px] px-2.5 transition-all duration-150 data-[active=true]:bg-[color:var(--vellum-heavy)] data-[active=true]:text-[color:var(--ink)] data-[active=true]:font-medium data-[active=true]:shadow-[inset_0_0_0_0.5px_rgba(26,31,28,0.10)] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    onClick={() => onOpenAgent(agent)}
                  >
                    <Bot className="size-4" />
                    <span className="flex-1 truncate">{agent.name}</span>
                    <span
                      className={`size-2 shrink-0 rounded-full ring-2 ring-sidebar ${AGENT_STATUS_COLOR[agent.status]}`}
                      aria-hidden="true"
                      title={agent.status}
                    />
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        </ExplorerSection>
      ) : null}
      {agentsQuery.isLoading && !agentsQuery.data ? (
        <div className="px-4 py-3 text-xs text-muted-foreground">
          Loading agents…
        </div>
      ) : null}
    </>
  )
}

function SkillsRailExplorer({
  workspaceId,
  activeEntityId,
  onOpenSkill,
  onOpenLibrary,
}: {
  workspaceId: string
  activeEntityId: string | null
  onOpenSkill: (skill: Skill) => void
  onOpenLibrary: () => void
}) {
  const skillsQuery = useQuery({
    ...skillListOptions(workspaceId),
    enabled: !!workspaceId,
  })
  const filter = useSkillsBrowseStore((s) => s.listFilter)
  const setFilter = useSkillsBrowseStore((s) => s.setListFilter)
  const setAddMode = useSkillsBrowseStore((s) => s.setAddMode)
  const editorActiveId = useSkillEditorStore((s) => s.activeSkillId)
  const editorFilePaths = useSkillEditorStore((s) => s.filePaths)
  const editorSelectedPath = useSkillEditorStore((s) => s.selectedPath)
  const setEditorSelectedPath = useSkillEditorStore((s) => s.setSelectedPath)

  const skills = skillsQuery.data ?? []
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return skills.filter(
      (s) =>
        !q ||
        s.name.toLowerCase().includes(q) ||
        (s.description?.toLowerCase().includes(q) ?? false),
    )
  }, [skills, filter])

  const handleAdd = () => {
    onOpenLibrary()
    setAddMode('browse')
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 pb-2">
        <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground tabular-nums">
          {skills.length} {skills.length === 1 ? 'skill' : 'skills'}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleAdd}
          aria-label="Add skill"
        >
          <Plus className="text-muted-foreground" />
        </Button>
      </div>
      <div className="shrink-0 px-3 pb-2">
        <InputGroup>
          <InputGroupAddon>
            <Search className="text-muted-foreground" />
          </InputGroupAddon>
          <InputGroupInput
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter"
          />
          {filter ? (
            <InputGroupAddon align="inline-end">
              <button
                type="button"
                onClick={() => setFilter('')}
                className="text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Clear filter"
              >
                <X className="size-3.5" />
              </button>
            </InputGroupAddon>
          ) : null}
        </InputGroup>
      </div>
      <div className="flex-1 overflow-y-auto pb-2">
        {skillsQuery.isLoading && !skillsQuery.data ? (
          <div className="px-4 py-3 text-xs text-muted-foreground">
            Loading skills…
          </div>
        ) : skills.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">
            <p className="text-foreground">No skills yet</p>
            <button
              type="button"
              onClick={handleAdd}
              className="mt-2 text-xs underline-offset-2 hover:text-foreground hover:underline"
            >
              Add the first one
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">
            <p className="text-foreground">No matches</p>
            <button
              type="button"
              onClick={() => setFilter('')}
              className="mt-2 text-xs underline-offset-2 hover:text-foreground hover:underline"
            >
              Clear filter
            </button>
          </div>
        ) : (
          <SidebarMenu>
            {visible.map((skill) => {
              const active = activeEntityId === skill.id
              const showTree =
                active &&
                editorActiveId === skill.id &&
                editorFilePaths.length > 0
              return (
                <div key={skill.id}>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={active}
                      className="rounded-[7px] px-2.5 transition-all duration-150 data-[active=true]:bg-[color:var(--vellum-heavy)] data-[active=true]:text-[color:var(--ink)] data-[active=true]:font-medium data-[active=true]:shadow-[inset_0_0_0_0.5px_rgba(26,31,28,0.10)] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                      onClick={() => onOpenSkill(skill)}
                    >
                      <span className="flex-1 truncate">{skill.name}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  {showTree ? (
                    <div className="mb-1 ml-3 border-l border-sidebar-border/60">
                      <FileTree
                        filePaths={editorFilePaths}
                        selectedPath={editorSelectedPath}
                        onSelect={setEditorSelectedPath}
                      />
                    </div>
                  ) : null}
                </div>
              )
            })}
          </SidebarMenu>
        )}
      </div>
    </div>
  )
}

function ConnectionsExplorer({
  activeEntityId,
  onOpenConnector,
}: {
  activeEntityId: ConnectorId | null
  onOpenConnector: (connector: ConnectionRowData) => void
}) {
  const snapshotQuery = useQuery({
    queryKey: ['workspace-connections-sidebar'],
    queryFn: loadConnectionsForSidebar,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  })

  const { connected, available } = useMemo(() => {
    const list = snapshotQuery.data?.connectors ?? []
    return {
      connected: list.filter(
        (c) => c.status === 'connected' || c.status === 'degraded',
      ),
      available: list.filter(
        (c) => c.status !== 'connected' && c.status !== 'degraded',
      ),
    }
  }, [snapshotQuery.data])

  const renderRow = (connector: ConnectionRowData) => {
    const active = activeEntityId === connector.id
    return (
      <SidebarMenuItem key={connector.id}>
        <SidebarMenuButton
          isActive={active}
          className="rounded-[7px] px-2.5 transition-all duration-150 data-[active=true]:bg-[color:var(--vellum-heavy)] data-[active=true]:text-[color:var(--ink)] data-[active=true]:font-medium data-[active=true]:shadow-[inset_0_0_0_0.5px_rgba(26,31,28,0.10)] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          onClick={() => onOpenConnector(connector)}
        >
          <ConnectorRowIcon id={connector.id} className="size-4" />
          <span className="flex-1 truncate">{connector.label}</span>
          <span
            className={`size-2 shrink-0 rounded-full ring-2 ring-sidebar ${connectorDotColor(connector.status)}`}
            aria-hidden="true"
            title={connector.status}
          />
        </SidebarMenuButton>
      </SidebarMenuItem>
    )
  }

  return (
    <>
      {connected.length > 0 ? (
        <ExplorerSection>
          <SidebarMenu>{connected.map(renderRow)}</SidebarMenu>
        </ExplorerSection>
      ) : null}
      {available.length > 0 ? (
        <ExplorerSection>
          <SidebarMenu>{available.map(renderRow)}</SidebarMenu>
        </ExplorerSection>
      ) : null}
      {snapshotQuery.isLoading && !snapshotQuery.data ? (
        <div className="px-4 py-3 text-xs text-muted-foreground">
          Loading connections…
        </div>
      ) : null}
    </>
  )
}
