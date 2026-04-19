'use client'

import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  IconBrandGithub,
  IconBrandGmail,
  IconBrandSlack,
  IconChecklist,
  IconHomeSpark,
  IconInbox,
  IconMessage2,
  IconMessage2Plus,
  IconPlugConnected,
  IconSettings2,
  IconSparkles2,
} from '@tabler/icons-react'
import { cn } from '@accelerate/ui/lib/utils'
import { BrandIcon } from '@accelerate/ui/components/common/brand-icon'
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
} from '@accelerate/ui/components/ui/sidebar'
import {
  deduplicateInboxItems,
  inboxListOptions,
} from '@accelerate/core/inbox/queries'
import type { InboxItem } from '@accelerate/core/types'
import { useAuthStore } from '@accelerate/core/auth'
import { useWorkspaceStore } from '@accelerate/core/workspace'
import { SearchTrigger } from '@/features/search'
import { ChatSessionExplorer } from '@/features/chat'
import { useNavigation } from '@/features/navigation'
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
  | 'settings'

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
    icon: IconHomeSpark,
    defaultPanel: { kind: 'inbox', title: 'Inbox' },
  },
  {
    id: 'chats',
    label: 'Chats',
    icon: IconMessage2,
    defaultPanel: { kind: 'chat', title: 'New Chat' },
  },
  {
    id: 'skills',
    label: 'Skills',
    icon: IconSparkles2,
    defaultPanel: { kind: 'skill-editor', title: 'Skills' },
  },
  {
    id: 'connections',
    label: 'Connections',
    icon: IconPlugConnected,
    defaultPanel: { kind: 'capabilities', title: 'Connections' },
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: IconSettings2,
    defaultPanel: { kind: 'settings', title: 'Settings' },
  },
]

const inboxTypeLabels: Partial<Record<InboxItem['type'], string>> = {
  issue_assigned: 'Assigned',
  mentioned: 'Mentioned',
  review_requested: 'Review',
  task_completed: 'Completed',
  task_failed: 'Failed',
  agent_blocked: 'Blocked',
  agent_completed: 'Finished',
}

function contextFromPanel(kind: WorkspacePanelKind | null): RailContext {
  switch (kind) {
    case 'chat':
      return 'chats'
    case 'skill-editor':
      return 'skills'
    case 'capabilities':
      return 'connections'
    case 'settings':
      return 'settings'
    case 'blank':
    case 'inbox':
    case 'issues':
    case 'issue-detail':
    default:
      return 'home'
  }
}

function ExplorerSection({
  label,
  count,
  children,
}: {
  label: string
  count?: number
  children: React.ReactNode
}) {
  return (
    <SidebarGroup className="px-0 py-1.5">
      <div className="flex items-center gap-2 px-4 pb-1">
        <SidebarGroupLabel className="h-auto px-0 text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
          {label}
        </SidebarGroupLabel>
        {typeof count === 'number' ? (
          <span className="text-[10px] text-muted-foreground">{count}</span>
        ) : null}
      </div>
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
        className="px-3"
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

function ExplorerEntityRow({
  label,
  meta,
  active = false,
  onClick,
  tone = 'default',
}: {
  label: string
  meta?: string
  active?: boolean
  onClick: () => void
  tone?: 'default' | 'muted' | 'warning'
}) {
  const dotClassName =
    tone === 'warning'
      ? 'bg-amber-400'
      : tone === 'muted'
        ? 'bg-muted-foreground/40'
        : 'bg-sidebar-accent-foreground/70'

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 border-b border-sidebar-border/50 px-3 py-2 text-left text-[13px] text-muted-foreground transition-colors last:border-b-0 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        active && 'bg-sidebar-accent text-sidebar-accent-foreground',
      )}
    >
      <span className={cn('size-2 shrink-0 rounded-full', dotClassName)} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {meta ? (
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {meta}
        </span>
      ) : null}
    </button>
  )
}

function ExplorerEmpty({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-2 text-[12px] text-muted-foreground">{children}</div>
}

export function WorkspaceSidebar() {
  const queryClient = useQueryClient()
  const { replace } = useNavigation()
  const { activePanel, openPanel } = useWorkspaceDock()
  const { setOpen } = useSidebar()
  const workspace = useWorkspaceStore((state) => state.workspace)
  const clearWorkspace = useWorkspaceStore((state) => state.clearWorkspace)
  const user = useAuthStore((state) => state.user)
  const logout = useAuthStore((state) => state.logout)
  const activeType = activePanel?.kind ?? null
  const activeEntityId = activePanel?.entityId
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
  const issueItems = inboxItems.filter((item) => !!item.issue_id).slice(0, 4)

  const revealExplorer = useCallback(() => {
    setOpen(true)
  }, [setOpen])

  const openInbox = useCallback(() => {
    openPanel({ kind: 'inbox', title: 'Inbox' })
  }, [openPanel])

  const openIssues = useCallback(() => {
    openPanel({ kind: 'issues', title: 'Active Work' })
  }, [openPanel])

  const openInboxItem = useCallback(
    (item: InboxItem) => {
      if (item.issue_id) {
        openPanel({
          kind: 'issue-detail',
          title: item.title,
          entityId: item.issue_id,
        })
        return
      }

      openInbox()
    },
    [openInbox, openPanel],
  )

  const openSettings = useCallback(() => {
    openPanel({ kind: 'settings', title: 'Settings' })
  }, [openPanel])

  const openRailContext = useCallback(
    (item: RailItem) => {
      revealExplorer()
      openPanel(item.defaultPanel)
    },
    [openPanel, revealExplorer],
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
      variant="inset"
      collapsible="icon"
      className="overflow-hidden *:data-[sidebar=sidebar]:flex-row"
    >
      <Sidebar
        collapsible="none"
        className="w-[calc(var(--sidebar-width-icon)+1px)]! border-r border-sidebar-border/70"
      >
        <SidebarHeader className="px-2 py-3">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                size="lg"
                className="justify-center md:h-9 md:p-0"
                tooltip={{
                  children: workspace?.name ?? 'Accelerate',
                  hidden: false,
                }}
                onClick={openInbox}
              >
                <div className="flex size-8 items-center justify-center rounded-lg border border-sidebar-border bg-background text-foreground">
                  <BrandIcon className="size-3.5" noSpin />
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent className="px-1.5 md:px-0">
              <SidebarMenu>
                {railItems.map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      tooltip={{
                        children: item.label,
                        hidden: false,
                      }}
                      isActive={activeRailId === item.id}
                      className="px-2.5 md:px-2"
                      onClick={() => openRailContext(item)}
                    >
                      <item.icon className="size-4" />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
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

      <Sidebar collapsible="none" className="hidden flex-1 md:flex">
        <SidebarHeader className="gap-3 border-b border-sidebar-border/70 p-2">
          <div className="px-2 text-sm font-medium text-foreground">
            {activeRail.label}
          </div>
          <SearchTrigger className="flex-1" />
        </SidebarHeader>

        <SidebarContent>
          {activeRailId === 'home' ? (
            <>
              <ExplorerSection label="Inbox" count={unreadCount}>
                <SidebarMenu>
                  <ExplorerActionRow
                    label="Inbox"
                    icon={IconInbox}
                    active={activeType === 'inbox'}
                    badge={unreadCount}
                    onClick={openInbox}
                  />
                </SidebarMenu>
                {inboxItems.length === 0 ? (
                  <ExplorerEmpty>No notifications yet.</ExplorerEmpty>
                ) : (
                  <div>
                    {inboxItems.map((item) => (
                      <ExplorerEntityRow
                        key={item.id}
                        label={item.title}
                        meta={
                          inboxTypeLabels[item.type] ??
                          item.type.replaceAll('_', ' ')
                        }
                        tone={item.read ? 'muted' : 'warning'}
                        active={
                          activeType === 'issue-detail' &&
                          !!item.issue_id &&
                          activeEntityId === item.issue_id
                        }
                        onClick={() => openInboxItem(item)}
                      />
                    ))}
                  </div>
                )}
              </ExplorerSection>

              <ExplorerSection label="Active Work" count={issueItems.length}>
                <SidebarMenu>
                  <ExplorerActionRow
                    label="Active Work"
                    icon={IconChecklist}
                    active={activeType === 'issues'}
                    onClick={openIssues}
                  />
                </SidebarMenu>
                {issueItems.length === 0 ? (
                  <ExplorerEmpty>No active work yet.</ExplorerEmpty>
                ) : (
                  <div>
                    {issueItems.map((item) => (
                      <ExplorerEntityRow
                        key={`${item.id}:issue`}
                        label={item.title}
                        active={
                          activeType === 'issue-detail' &&
                          !!item.issue_id &&
                          activeEntityId === item.issue_id
                        }
                        onClick={() => openInboxItem(item)}
                      />
                    ))}
                  </div>
                )}
              </ExplorerSection>
            </>
          ) : null}

          {activeRailId === 'chats' ? (
            <ExplorerSection label="Chats">
              <SidebarMenu>
                <ExplorerActionRow
                  label="New Chat"
                  icon={IconMessage2Plus}
                  active={activeType === 'chat'}
                  onClick={() => openPanel({ kind: 'chat', title: 'New Chat' })}
                />
              </SidebarMenu>
              <div className="pt-2">
                <ChatSessionExplorer
                  onActivate={() => openPanel({ kind: 'chat', title: 'New Chat' })}
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
            <>
              <ExplorerSection label="Connected">
                <SidebarMenu>
                  <ExplorerActionRow
                    label="Connections"
                    icon={IconPlugConnected}
                    active={activeType === 'capabilities'}
                    onClick={() =>
                      openPanel({
                        kind: 'capabilities',
                        title: 'Connections',
                      })
                    }
                  />
                </SidebarMenu>
              </ExplorerSection>

              <ExplorerSection label="Available" count={3}>
                <SidebarMenu>
                  <ExplorerActionRow
                    label="Gmail"
                    icon={IconBrandGmail}
                    onClick={() =>
                      openPanel({
                        kind: 'capabilities',
                        title: 'Connections',
                      })
                    }
                  />
                  <ExplorerActionRow
                    label="Slack"
                    icon={IconBrandSlack}
                    onClick={() =>
                      openPanel({
                        kind: 'capabilities',
                        title: 'Connections',
                      })
                    }
                  />
                  <ExplorerActionRow
                    label="GitHub"
                    icon={IconBrandGithub}
                    onClick={() =>
                      openPanel({
                        kind: 'capabilities',
                        title: 'Connections',
                      })
                    }
                  />
                </SidebarMenu>
              </ExplorerSection>
            </>
          ) : null}

          {activeRailId === 'settings' ? (
            <ExplorerSection label="Settings" count={1}>
              <SidebarMenu>
                <ExplorerActionRow
                  label="Workspace Settings"
                  icon={IconSettings2}
                  active={activeType === 'settings'}
                  onClick={openSettings}
                />
              </SidebarMenu>
            </ExplorerSection>
          ) : null}
        </SidebarContent>
      </Sidebar>
    </Sidebar>
  )
}
