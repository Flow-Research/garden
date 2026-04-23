'use client'

import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { IconMessage2Plus, IconSparkles2 } from '@tabler/icons-react'
import { Plug } from 'lucide-react'
import { Icon as IconifyIcon } from '@iconify/react'
import { BrandIcon } from '@garden/ui/components/common/brand-icon'
import type { ConnectorId } from '@garden/connectors/registry'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@garden/ui/components/ui/sidebar'
import {
  deduplicateInboxItems,
  inboxListOptions,
} from '@garden/core/inbox/queries'
import { useAuthStore } from '@garden/core/auth'
import { useWorkspaceStore } from '@garden/core/workspace'
import { SearchTrigger } from '@/features/search'
import { ChatSessionExplorer } from '@/features/chat'
import { useAgentSessions } from '@/features/chat/use-agent-chat-sessions'
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
  | 'skills'
  | 'connections'

type RailItem = {
  id: RailContext
  label: string
  icon: React.ComponentType<{ className?: string }>
  defaultPanel: WorkspacePanelInput
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
    id: 'skills',
    label: 'Skills',
    icon: RailSkillsIcon,
    defaultPanel: { kind: 'skill-editor', title: 'Skills' },
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
    case 'skill-editor':
      return 'skills'
    case 'capabilities':
      return 'connections'
    case 'blank':
    case 'dashboard':
    case 'inbox':
    case 'issues':
    case 'issue-detail':
    default:
      return 'home'
  }
}

function HomeDashboardIcon({ className }: { className?: string }) {
  return <IconifyIcon icon="ic:sharp-dashboard" className={className} />
}

function RailHomeIcon({ className }: { className?: string }) {
  return <IconifyIcon icon="hugeicons:home-05" className={className} />
}

function RailChatsIcon({ className }: { className?: string }) {
  return <IconifyIcon icon="hugeicons:bubble-chat" className={className} />
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
    <IconifyIcon icon="material-symbols:inbox-outline-sharp" className={className} />
  )
}

function ExplorerSection({
  label,
  count,
  children,
}: {
  label?: string
  count?: number
  children: React.ReactNode
}) {
  return (
    <SidebarGroup className="px-0 py-1.5">
      {label ? (
        <div className="flex items-center gap-2 px-4 pb-1">
          <SidebarGroupLabel className="h-auto px-0 text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
            {label}
          </SidebarGroupLabel>
          {typeof count === 'number' ? (
            <span className="text-[10px] text-muted-foreground">{count}</span>
          ) : null}
        </div>
      ) : null}
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
        className="rounded-[2px] px-3"
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

export function WorkspaceSidebar() {
  const queryClient = useQueryClient()
  const { replace } = useNavigation()
  const { activePanel, openPanel } = useWorkspaceDock()
  const { createSession, sessions } = useAgentSessions()
  const { setOpen } = useSidebar()
  const workspace = useWorkspaceStore((state) => state.workspace)
  const clearWorkspace = useWorkspaceStore((state) => state.clearWorkspace)
  const user = useAuthStore((state) => state.user)
  const logout = useAuthStore((state) => state.logout)
  const openSettingsDialog = useSettingsDialogStore((s) => s.openSettings)
  const activeType = activePanel?.kind ?? null
  const activeEntityId = activePanel?.entityId ?? null
  const activeRailId = contextFromPanel(activeType)
  const activeRail = railItems.find((item) => item.id === activeRailId) ?? railItems[0]
  const workspaceId = workspace?.id ?? ''

  const { data: rawInboxItems = [] } = useQuery({
    ...inboxListOptions(workspaceId),
    enabled: !!workspaceId,
  })

  const inboxItems = useMemo(
    () => deduplicateInboxItems(rawInboxItems).slice(0, 6),
    [rawInboxItems],
  )
  const unreadCount = inboxItems.filter((item) => !item.read).length

  const revealExplorer = useCallback(() => {
    setOpen(true)
  }, [setOpen])

  const openInbox = useCallback(() => {
    openPanel({ kind: 'inbox', title: 'Inbox' })
  }, [openPanel])

  const openDashboard = useCallback(() => {
    openPanel({ kind: 'dashboard', title: 'Dashboard' })
  }, [openPanel])

  const openTasks = useCallback(() => {
    openPanel({ kind: 'issues', title: 'Tasks' })
  }, [openPanel])

  const openSettings = useCallback(() => {
    openSettingsDialog()
  }, [openSettingsDialog])

  const openRailContext = useCallback(
    (item: RailItem) => {
      revealExplorer()
      if (item.id === 'chats') {
        const latestThread = sessions[0] ?? null
        if (latestThread) {
          openPanel({
            kind: 'chat',
            title: latestThread.title,
            entityId: latestThread.id,
          })
          return
        }

        void createSession.mutateAsync('New Chat').then((session) => {
          openPanel({
            kind: 'chat',
            title: session.title,
            entityId: session.id,
          })
        })
        return
      }

      openPanel(item.defaultPanel)
    },
    [createSession, openPanel, revealExplorer, sessions],
  )

  const handleLogout = useCallback(async () => {
    try {
      await logout()
      queryClient.clear()
      clearWorkspace()
      toast.success('Signed out')
      replace('/login')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to sign out')
    }
  }, [clearWorkspace, logout, queryClient, replace])

  return (
    <Sidebar
      collapsible="icon"
      className="overflow-hidden border-r-0 *:data-[sidebar=sidebar]:flex-row"
    >
      <Sidebar
        collapsible="none"
        className="w-[calc(var(--sidebar-width-icon)+1px)]! border-r-[3px] border-sidebar-border"
      >
        <SidebarHeader className="p-0">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                size="lg"
                aria-label={workspace?.name ?? 'Garden'}
                className="!h-12 !w-full !gap-0 !p-0 justify-center rounded-none group-data-[collapsible=icon]:!h-12 group-data-[collapsible=icon]:!w-full"
                tooltip={{
                  children: workspace?.name ?? 'Garden',
                  hidden: false,
                }}
                onClick={openDashboard}
              >
                <div className="flex size-8 items-center justify-center rounded-[2px] border border-sidebar-border bg-background text-foreground">
                  <BrandIcon className="size-3.5" noSpin />
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
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      tooltip={{
                        children: item.label,
                        hidden: false,
                      }}
                      aria-label={item.label}
                      isActive={activeRailId === item.id}
                      className="!h-10 !w-full !gap-0 !p-0 justify-center !rounded-none group-data-[collapsible=icon]:!h-10 group-data-[collapsible=icon]:!w-full"
                      onClick={() => openRailContext(item)}
                    >
                      <item.icon className="!size-[22px] shrink-0" />
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="p-0">
          <SidebarMenu className="gap-0">
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip={{
                  children: 'Settings',
                  hidden: false,
                }}
                aria-label="Settings"
                className="!h-10 !w-full !gap-0 !p-0 justify-center !rounded-none group-data-[collapsible=icon]:!h-10 group-data-[collapsible=icon]:!w-full"
                onClick={openSettings}
              >
                <RailSettingsIcon className="!size-[22px] shrink-0" />
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <NavUser
            user={{
              name: user?.name ?? 'Account',
              email: user?.email ?? 'Signed out',
              avatar: user?.avatar_url ?? null,
            }}
            onAccount={openSettings}
            onLogout={() => {
              void handleLogout()
            }}
          />
        </SidebarFooter>
      </Sidebar>

      <Sidebar
        collapsible="none"
        className="hidden flex-1 md:flex group-data-[state=collapsed]:md:hidden"
      >
        <SidebarHeader className="gap-3 p-2">
          <div className="px-2">
            <span className="text-sm font-medium text-foreground">
              {activeRail.label}
            </span>
          </div>
          <SearchTrigger className="flex-1" />
        </SidebarHeader>

        <SidebarContent>
          {activeRailId === 'home' ? (
            <>
              <ExplorerSection label="Home">
                <SidebarMenu>
                  <ExplorerActionRow
                    label="Dashboard"
                    icon={HomeDashboardIcon}
                    active={activeType === 'dashboard'}
                    onClick={openDashboard}
                  />
                  <ExplorerActionRow
                    label="Tasks"
                    icon={HomeTasksIcon}
                    active={activeType === 'issues'}
                    onClick={openTasks}
                  />
                  <ExplorerActionRow
                    label="Inbox"
                    icon={HomeInboxIcon}
                    active={activeType === 'inbox'}
                    badge={unreadCount}
                    onClick={openInbox}
                  />
                </SidebarMenu>
              </ExplorerSection>
            </>
          ) : null}

          {activeRailId === 'chats' ? (
            <ExplorerSection>
              <SidebarMenu>
                <ExplorerActionRow
                  label="New Chat"
                  icon={IconMessage2Plus}
                  active={activeType === 'chat'}
                  onClick={() => {
                    void createSession.mutateAsync('New Chat').then((session) => {
                      openPanel({
                        kind: 'chat',
                        title: session.title,
                        entityId: session.id,
                      })
                    })
                  }}
                />
              </SidebarMenu>
              <div className="mt-2 border-t border-sidebar-border/70 pt-2">
                <ChatSessionExplorer
                  onActivate={(session) =>
                    openPanel({
                      kind: 'chat',
                      title: session.title,
                      entityId: session.id,
                    })
                  }
                />
              </div>
            </ExplorerSection>
          ) : null}

          {activeRailId === 'skills' ? (
            <ExplorerSection label="Skills" count={1}>
              <SidebarMenu>
                <ExplorerActionRow
                  label="Library"
                  icon={IconSparkles2}
                  active={activeType === 'skill-editor'}
                  onClick={() =>
                    openPanel({ kind: 'skill-editor', title: 'Skills' })
                  }
                />
              </SidebarMenu>
            </ExplorerSection>
          ) : null}

          {activeRailId === 'connections' ? (
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
  const response = await fetch('/api/connections', { credentials: 'include' })
  if (!response.ok) throw new Error('Failed to load connections')
  return (await response.json()) as ConnectionsSnapshotLite
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

function ConnectionsExplorer({
  activeEntityId,
  onOpenConnector,
}: {
  activeEntityId: ConnectorId | null
  onOpenConnector: (connector: ConnectionRowData) => void
}) {
  const snapshotQuery = useQuery({
    queryKey: ['workspace-connections'],
    queryFn: loadConnectionsForSidebar,
    staleTime: 20_000,
  })

  const { connected, available } = useMemo(() => {
    const list = snapshotQuery.data?.connectors ?? []
    return {
      connected: list.filter((c) => c.status === 'connected' || c.status === 'degraded'),
      available: list.filter((c) => c.status !== 'connected' && c.status !== 'degraded'),
    }
  }, [snapshotQuery.data])

  const renderRow = (connector: ConnectionRowData) => {
    const active = activeEntityId === connector.id
    return (
      <SidebarMenuItem key={connector.id}>
        <SidebarMenuButton
          isActive={active}
          className="rounded-[2px] px-3"
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
        <ExplorerSection label="Connected" count={connected.length}>
          <SidebarMenu>{connected.map(renderRow)}</SidebarMenu>
        </ExplorerSection>
      ) : null}
      {available.length > 0 ? (
        <ExplorerSection label="Available" count={available.length}>
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
