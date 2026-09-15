import { useCallback, useMemo, useState } from 'react'
import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Result } from 'better-result'
import { toast } from 'sonner'
import { AppFab } from '@garden/ui/components/shell/app-fab'
import { AppSidebar } from '@garden/ui/components/shell/app-sidebar'
import { AppTopBar } from '@garden/ui/components/shell/app-topbar'
import { Button } from '@garden/ui/components/ui/button'
import { Skeleton } from '@garden/ui/components/ui/skeleton'
import { useAuthStore } from '@garden/app-state/auth'
import { useWorkspaceStore } from '@garden/app-state/workspace'
import { deduplicateInboxItems, inboxListOptions } from '@/lib/inbox/queries'
import { workspaceListOptions } from '@/lib/workspace/queries'
import {
  agentListOptions,
  connectionListOptions,
  memberListOptions,
  skillListOptions,
} from '@/lib/workspace/queries'
import { useSettingsDialogStore } from '@/features/settings'
import { SettingsDialog } from '@/features/settings'
import { SearchCommand } from '@/features/search'
import { ChatRuntimeProvider } from '@/features/chat/chat-runtime-provider'
import { CreateWorkspaceModal } from '@/features/modals/create-workspace'
import {
  EMPTY_SURFACE_TABS,
  useSurfaceTabsStore,
  withActiveTab,
} from '@garden/app-state/surface-tabs'
import { NAV_ITEMS, navItemForPathname } from '@/features/navigation/nav-items'
import { useSurfaceNavigation } from '@/features/navigation/use-surface-navigation'
import { ChatTabsStrip } from './chat-tabs'
import { TaskTabsStrip } from './task-tabs'
import { UserCard } from './user-card'
import { WorkspaceMenu } from './workspace-menu'

/**
 * Mount-only prefetch for workspace-wide caches (agents, members, skills,
 * connections) so dialogs/pickers read warm caches instead of cold-fetching on
 * open. Moved unchanged from the retired workspace-layout; still renders null.
 */
function WorkspaceWarmCaches({ wsId }: { wsId: string }) {
  useQuery(agentListOptions(wsId))
  useQuery(memberListOptions(wsId))
  useQuery(skillListOptions(wsId))
  useQuery(connectionListOptions(wsId))
  return null
}

function WorkspaceLoadingSkeleton() {
  return (
    <section
      className="flex h-full flex-1 flex-col gap-3 p-4"
      aria-label="Loading workspace"
      aria-busy="true"
    >
      <div className="flex items-center gap-3">
        <Skeleton className="size-7 rounded-md" />
        <Skeleton className="h-3 w-40" />
      </div>
      <Skeleton className="h-9 w-full rounded-md" />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-4 w-full rounded-md" />
        <Skeleton className="h-4 w-11/12 rounded-md" />
        <Skeleton className="h-4 w-10/12 rounded-md" />
        <Skeleton className="h-4 w-9/12 rounded-md" />
      </div>
    </section>
  )
}

function WorkspaceSetupState({ onCreate }: { onCreate: () => void }) {
  return (
    <section className="flex h-full flex-1 items-center justify-center px-6">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <div className="space-y-1.5">
          <h2 className="text-sm font-medium text-text-neutral-default">
            Create a workspace
          </h2>
          <p className="text-sm text-text-secondary">
            Your account is ready. Create a workspace or open an invitation link
            to join one.
          </p>
        </div>
        <Button size="sm" onClick={onCreate}>
          New workspace
        </Button>
      </div>
    </section>
  )
}

/**
 * The redesigned app shell: flat labeled sidebar + 40px top bar + routed
 * content pane (Penpot "Garden" file, 2026-09). Replaces the icon rail +
 * context rail + FlexLayout dock. All authenticated surfaces render as routes
 * inside the Outlet; chat runtime, search, settings dialog, and workspace
 * cache warming mount once here.
 */
export function AppShell() {
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const queryClient = useQueryClient()

  const user = useAuthStore((state) => state.user)
  const logout = useAuthStore((state) => state.logout)
  const workspace = useWorkspaceStore((state) => state.workspace)
  const switchWorkspace = useWorkspaceStore((state) => state.switchWorkspace)
  const clearWorkspace = useWorkspaceStore((state) => state.clearWorkspace)
  const openSettingsDialog = useSettingsDialogStore((s) => s.openSettings)

  const { openIssue, openChatSession } = useSurfaceNavigation()
  const [collapsed, setCollapsed] = useState(false)
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false)

  const workspaceId = workspace?.id ?? ''
  const workspaceListQuery = useQuery(workspaceListOptions())
  const { data: rawInboxItems = [] } = useQuery({
    ...inboxListOptions(workspaceId),
    enabled: !!workspaceId,
  })
  const memberListQuery = useQuery({
    ...memberListOptions(workspaceId),
    enabled: !!workspaceId,
  })
  const currentMemberRole = useMemo(
    () =>
      memberListQuery.data?.find((member) => member.user_id === user?.id)
        ?.role ?? null,
    [memberListQuery.data, user?.id],
  )

  const unreadCount = useMemo(
    () =>
      deduplicateInboxItems(rawInboxItems).filter((item) => !item.read).length,
    [rawInboxItems],
  )

  const activeNavId = navItemForPathname(pathname)?.id ?? null

  // Tab arrows (tabbable surfaces only): step the active selection through the
  // surface's open tabs. Active id comes from the route param when present.
  const tabbedNav =
    activeNavId === 'chats' || activeNavId === 'tasks' ? activeNavId : null
  const storedSurfaceTabs = useSurfaceTabsStore((s) =>
    tabbedNav
      ? (s.bySurface[tabbedNav] ?? EMPTY_SURFACE_TABS)
      : EMPTY_SURFACE_TABS,
  )
  const activeTabId = useRouterState({
    select: (s) => {
      const params = s.matches[s.matches.length - 1]?.params as
        | { threadId?: string; issueId?: string }
        | undefined
      return params?.threadId ?? params?.issueId ?? null
    },
  })
  const surfaceTabs = useMemo(
    () => withActiveTab(storedSurfaceTabs, tabbedNav ? activeTabId : null),
    [storedSurfaceTabs, tabbedNav, activeTabId],
  )
  const tabStep = useMemo(() => {
    const current = surfaceTabs.findIndex((tab) => tab.id === activeTabId)
    return { current, count: surfaceTabs.length }
  }, [surfaceTabs, activeTabId])

  const stepTab = useCallback(
    (direction: -1 | 1) => {
      if (!tabbedNav) return
      const next = surfaceTabs[tabStep.current + direction]
      if (!next) return
      if (tabbedNav === 'chats') openChatSession(next)
      else openIssue(next)
    },
    [tabbedNav, surfaceTabs, tabStep.current, openChatSession, openIssue],
  )

  const navItems = useMemo(
    () =>
      NAV_ITEMS.map((item) => ({
        ...item,
        badge: item.id === 'inbox' && unreadCount > 0 ? unreadCount : undefined,
      })),
    [unreadCount],
  )

  const handleSelectNav = useCallback(
    (id: string) => {
      const item = NAV_ITEMS.find((entry) => entry.id === id)
      if (item) void navigate({ to: item.to })
    },
    [navigate],
  )

  const handleSwitchWorkspace = useCallback(
    (nextWorkspace: NonNullable<typeof workspace>) => {
      if (nextWorkspace.id === workspace?.id) return
      // Navigate first: a mounted entity route must never re-render against
      // the new workspace with foreign ids (doomed detail queries).
      void navigate({ to: '/home' })
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
    [navigate, queryClient, switchWorkspace, workspace?.id],
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
    void navigate({ to: '/login', search: { redirect: undefined } })
  }, [clearWorkspace, logout, queryClient, navigate])

  const hasSession = Boolean(user)
  const activeWorkspaceId = workspace?.id ?? null
  // Store hydration lands in a microtask after the first client frame; show a
  // neutral skeleton rather than the setup prompt while it resolves.
  const isRestoringWorkspace = !hasSession && !activeWorkspaceId

  return (
    <div className="flex h-svh bg-background-main-default">
      {activeWorkspaceId ? (
        <>
          <WorkspaceWarmCaches wsId={activeWorkspaceId} />
          <ChatRuntimeProvider>
            <AppSidebar
              header={
                <WorkspaceMenu
                  collapsed={collapsed}
                  onInviteMembers={() => openSettingsDialog('members')}
                  onOpenSettings={() => openSettingsDialog()}
                  onOpenMembers={() => openSettingsDialog('members')}
                />
              }
              items={navItems}
              activeId={activeNavId}
              onSelect={handleSelectNav}
              collapsed={collapsed}
              userCard={
                <UserCard
                  user={{
                    id: user?.id ?? '',
                    name: user?.name ?? 'Account',
                    email: user?.email ?? 'Signed out',
                    avatar: user?.avatar_url ?? null,
                  }}
                  role={currentMemberRole}
                  workspaces={workspaceListQuery.data ?? []}
                  currentWorkspaceId={workspace?.id ?? null}
                  collapsed={collapsed}
                  onAccount={() => openSettingsDialog()}
                  onInviteMembers={() => openSettingsDialog('members')}
                  onLogout={() => void handleLogout()}
                  onSwitchWorkspace={handleSwitchWorkspace}
                  onCreateWorkspace={() => setCreateWorkspaceOpen(true)}
                />
              }
            />
            <div className="flex min-w-0 flex-1 flex-col">
              <AppTopBar
                onToggleSidebar={() => setCollapsed((value) => !value)}
                onPrevious={() => stepTab(-1)}
                onNext={() => stepTab(1)}
                canGoPrevious={tabStep.current > 0}
                canGoNext={tabStep.current < tabStep.count - 1}
                showTabArrows={tabbedNav !== null}
                tabs={
                  tabbedNav === 'chats' ? (
                    <ChatTabsStrip activeId={activeTabId} />
                  ) : tabbedNav === 'tasks' ? (
                    <TaskTabsStrip activeId={activeTabId} />
                  ) : null
                }
              />
              <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
                <Outlet />
                {/* Harnessy FAB shell (Penpot "Harnessy_FAB"); popover behavior
                    lands with the Harnessy surface. */}
                <AppFab />
              </main>
            </div>
            <SearchCommand />
            <SettingsDialog />
          </ChatRuntimeProvider>
        </>
      ) : (
        <main className="flex min-h-0 flex-1 flex-col">
          {isRestoringWorkspace ? (
            <WorkspaceLoadingSkeleton />
          ) : (
            <WorkspaceSetupState
              onCreate={() => setCreateWorkspaceOpen(true)}
            />
          )}
        </main>
      )}
      {createWorkspaceOpen ? (
        <CreateWorkspaceModal onClose={() => setCreateWorkspaceOpen(false)} />
      ) : null}
    </div>
  )
}
