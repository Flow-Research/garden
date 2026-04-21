import { useLayoutEffect, useMemo, useState } from 'react'
import { useAuthStore } from '@garden/core/auth'
import { WorkspaceIdProvider } from '@garden/core/hooks'
import { defaultStorage } from '@garden/core/platform'
import { useWorkspaceStore } from '@garden/core/workspace'
import {
  SidebarInset,
  SidebarProvider,
} from '@garden/ui/components/ui/sidebar'
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
  const [preferredWorkspaceId, setPreferredWorkspaceId] = useState<
    string | null
  >(null)

  useLayoutEffect(() => {
    setPreferredWorkspaceId(defaultStorage.getItem('accelerate_workspace_id'))
  }, [])

  const activeWorkspaceId = workspace?.id ?? preferredWorkspaceId
  const headerTitle = useMemo(() => {
    if (workspace?.name) return workspace.name
    return 'Garden'
  }, [workspace?.name])

  return (
    <SidebarProvider className="h-svh flex-col">
      {activeWorkspaceId ? (
        <WorkspaceIdProvider wsId={activeWorkspaceId}>
          <WorkspaceDockProvider workspaceId={activeWorkspaceId}>
            <WorkspaceDockTitlebar
              title={headerTitle}
              subtitle={workspace?.id ? 'Workspace' : 'Restoring workspace'}
            />
            <div className="relative flex min-h-0 flex-1 overflow-hidden bg-background">
              <WorkspaceSidebar />
              <SidebarInset className="relative overflow-hidden">
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
            <div className="relative flex min-h-0 flex-1 overflow-hidden bg-background">
              <SidebarInset className="relative overflow-hidden">
                <div className="relative flex min-h-0 flex-1 overflow-hidden">
                  <EmptyWorkspaceState loading />
                </div>
              </SidebarInset>
            </div>
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
