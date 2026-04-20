import { useMemo } from 'react'
import { useAuthStore } from '@garden/core/auth'
import { WorkspaceIdProvider } from '@garden/core/hooks'
import { useWorkspaceStore } from '@garden/core/workspace'
import { BrandIcon } from '@garden/ui/components/common/brand-icon'
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from '@garden/ui/components/ui/sidebar'
import { Skeleton } from '@garden/ui/components/ui/skeleton'
import { Spinner } from '@garden/ui/components/ui/spinner'
import { SearchCommand } from '@/features/search'
import { OnboardingOverlay } from '@/features/onboarding'
import { useOnboardingStore } from '@/features/onboarding'
import { WorkspaceSidebar } from './sidebar'
import {
  WorkspaceDockProvider,
  WorkspaceDockTitlebar,
  WorkspaceDockView,
} from './workspace-dock'

function EmptyWorkspaceState({
  loading,
}: {
  loading: boolean
}) {
  return (
    <section className="flex h-full flex-1 items-center justify-center px-6">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        {loading ? <Spinner className="size-5" /> : null}
        <div className="space-y-1">
          <h2 className="text-sm font-medium text-foreground">
            {loading ? 'Restoring workspace' : 'Finish workspace setup'}
          </h2>
          <p className="text-sm text-muted-foreground">
            {loading
              ? 'Restoring your workspace and tabs.'
              : 'Create or choose a workspace to start working.'}
          </p>
        </div>
      </div>
    </section>
  )
}

function RestoringWorkspaceShell() {
  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden bg-background">
      <aside className="flex w-[calc(var(--sidebar-width-icon)+1px)] shrink-0 flex-col border-r border-sidebar-border/70 bg-sidebar">
        <div className="px-2 py-3">
          <div className="flex size-9 items-center justify-center rounded-lg border border-sidebar-border bg-background text-foreground">
            <BrandIcon className="size-3.5" noSpin />
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-1 px-1.5 py-2">
          {['Home', 'Chats', 'Skills', 'Connections', 'Settings'].map((label) => (
            <div
              key={label}
              className="flex h-9 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground"
            >
              <Skeleton className="size-4 rounded-sm" />
              <span className="sr-only">{label}</span>
            </div>
          ))}
        </div>

        <div className="border-t border-sidebar-border/70 p-2">
          <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
            <Skeleton className="size-8 rounded-md" />
          </div>
        </div>
      </aside>

      <aside className="hidden w-[var(--sidebar-width)] shrink-0 border-r border-sidebar-border/70 bg-sidebar md:flex md:flex-col">
        <div className="border-b border-sidebar-border/70 p-2">
          <Skeleton className="h-9 w-full rounded-md" />
        </div>
        <div className="flex flex-1 flex-col gap-4 p-3">
          <div className="space-y-2">
            <div className="px-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Home
            </div>
            <Skeleton className="h-8 w-full rounded-md" />
            <Skeleton className="h-8 w-full rounded-md" />
            <Skeleton className="h-8 w-full rounded-md" />
          </div>
          <div className="space-y-2">
            <div className="px-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Active Work
            </div>
            <Skeleton className="h-8 w-full rounded-md" />
            <Skeleton className="h-8 w-full rounded-md" />
          </div>
        </div>
      </aside>

      <SidebarInset className="relative overflow-hidden">
        <div className="pointer-events-none absolute top-3 left-3 z-20">
          <div className="pointer-events-auto flex size-8 items-center justify-center rounded-md border border-sidebar-border/70 bg-background/95 shadow-sm">
            <Skeleton className="size-3.5 rounded-sm" />
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="border-b border-border/70 px-4 py-3">
            <div className="flex items-center gap-2">
              <Skeleton className="h-8 w-40 rounded-md" />
              <Skeleton className="h-8 w-24 rounded-md" />
            </div>
          </div>

          <section className="flex min-h-0 flex-1 items-center justify-center px-6">
            <div
              className="flex max-w-sm flex-col items-center gap-3 text-center"
              data-testid="workspace-restore-shell"
            >
              <Spinner className="size-5" />
              <div className="space-y-1">
                <h2 className="text-sm font-medium text-foreground">
                  Restoring workspace
                </h2>
                <p className="text-sm text-muted-foreground">
                  Bringing back your workspace state and open tabs.
                </p>
              </div>
            </div>
          </section>
        </div>
      </SidebarInset>
    </div>
  )
}

function WorkspaceExplorerToggle() {
  const { state } = useSidebar()
  const label =
    state === 'expanded'
      ? 'Collapse entity explorer'
      : 'Expand entity explorer'

  return (
    <div className="pointer-events-none absolute top-3 left-3 z-20">
      <SidebarTrigger
        aria-label={label}
        title={label}
        className="pointer-events-auto border border-sidebar-border/70 bg-background/95 text-muted-foreground shadow-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      />
    </div>
  )
}

export function WorkspaceLayout() {
  const user = useAuthStore((state) => state.user)
  const authLoading = useAuthStore((state) => state.isLoading)
  const workspace = useWorkspaceStore((state) => state.workspace)
  const onboardingCompleted = useOnboardingStore((state) => state.completed)
  const markOnboardingCompleted = useOnboardingStore(
    (state) => state.markCompleted,
  )

  const hasSession = Boolean(user)
  const needsOnboarding =
    !authLoading && hasSession && !workspace?.id && !onboardingCompleted
  const isRestoringWorkspace = authLoading || (hasSession && !needsOnboarding)
  const headerTitle = useMemo(() => {
    if (workspace?.name) return workspace.name
    return 'Garden'
  }, [workspace?.name])

  return (
    <SidebarProvider className="h-svh flex-col">
      {workspace?.id ? (
        <WorkspaceIdProvider wsId={workspace.id}>
          <WorkspaceDockProvider workspaceId={workspace.id}>
            <WorkspaceDockTitlebar
              title={workspace.name}
              subtitle="Workspace"
            />
            <div className="relative flex min-h-0 flex-1 overflow-hidden bg-background">
              <WorkspaceSidebar />
              <SidebarInset className="relative overflow-hidden">
                <WorkspaceExplorerToggle />
                <div className="relative flex min-h-0 flex-1 overflow-hidden">
                  <WorkspaceDockView />
                </div>
              </SidebarInset>
              <SearchCommand />
            </div>
          </WorkspaceDockProvider>
        </WorkspaceIdProvider>
      ) : (
        <>
          <WorkspaceDockTitlebar
            title={headerTitle}
            subtitle={isRestoringWorkspace ? 'Restoring workspace' : 'Workspace setup'}
          />
          {isRestoringWorkspace ? (
            <RestoringWorkspaceShell />
          ) : (
            <div className="relative flex min-h-0 flex-1 overflow-hidden bg-background">
              <SidebarInset className="relative overflow-hidden">
                <div className="relative flex min-h-0 flex-1 overflow-hidden">
                  <EmptyWorkspaceState loading={false} />
                </div>
              </SidebarInset>
            </div>
          )}
        </>
      )}

      <OnboardingOverlay
        open={needsOnboarding}
        onComplete={markOnboardingCompleted}
      />
    </SidebarProvider>
  )
}
