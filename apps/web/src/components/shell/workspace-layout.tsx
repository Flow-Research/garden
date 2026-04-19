import { useMemo } from 'react'
import { useAuthStore } from '@accelerate/core/auth'
import { WorkspaceIdProvider } from '@accelerate/core/hooks'
import { useWorkspaceStore } from '@accelerate/core/workspace'
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from '@accelerate/ui/components/ui/sidebar'
import { Spinner } from '@accelerate/ui/components/ui/spinner'
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
            {loading ? 'Opening workspace' : 'Finish workspace setup'}
          </h2>
          <p className="text-sm text-muted-foreground">
            {loading
              ? 'Restoring your tabs and syncing the current workspace.'
              : 'Create or choose a workspace to start working.'}
          </p>
        </div>
      </div>
    </section>
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
  const headerTitle = useMemo(() => {
    if (workspace?.name) return workspace.name
    return 'Accelerate'
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
            subtitle={
              authLoading || (hasSession && !needsOnboarding)
                ? 'Opening workspace'
                : 'Workspace setup'
            }
          />
          <div className="relative flex min-h-0 flex-1 overflow-hidden bg-background">
            <SidebarInset className="relative overflow-hidden">
              <div className="relative flex min-h-0 flex-1 overflow-hidden">
                <EmptyWorkspaceState
                  loading={authLoading || (hasSession && !needsOnboarding)}
                />
              </div>
            </SidebarInset>
          </div>
        </>
      )}

      <OnboardingOverlay
        open={needsOnboarding}
        onComplete={markOnboardingCompleted}
      />
    </SidebarProvider>
  )
}
