import { useLayoutEffect, useState } from 'react'
import { useAuthStore } from '@garden/core/auth'
import { WorkspaceIdProvider } from '@garden/core/hooks'
import { defaultStorage } from '@garden/core/platform'
import { useWorkspaceStore } from '@garden/core/workspace'
import {
  SidebarInset,
  SidebarProvider,
} from '@garden/ui/components/ui/sidebar'
import { Skeleton } from '@garden/ui/components/ui/skeleton'
import { SearchCommand } from '@/features/search'
import { ChatRuntimeProvider } from '@/features/chat/chat-runtime-provider'
import { OnboardingOverlay } from '@/features/onboarding'
import { useOnboardingStore } from '@/features/onboarding'
import { SettingsDialog } from '@/features/settings'
import { WorkspaceSidebar } from './sidebar'
import {
  WorkspaceDockProvider,
  WorkspaceDockTitlebar,
  WorkspaceDockView,
} from './workspace-dock'

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

function WorkspaceSetupState() {
  return (
    <section className="flex h-full flex-1 items-center justify-center px-6">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <div className="space-y-1">
          <h2 className="text-sm font-medium text-foreground">
            Finish workspace setup
          </h2>
          <p className="text-sm text-muted-foreground">
            Create or choose a workspace to start working.
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
  const hasWorkspace = Boolean(workspace?.id)
  const titleNode = hasWorkspace ? (
    (workspace?.name ?? null)
  ) : (
    <Skeleton className="h-3.5 w-28" aria-label="Loading workspace name" />
  )
  const subtitleNode = hasWorkspace ? (
    'Workspace'
  ) : (
    <Skeleton className="mt-1 h-2.5 w-16" aria-hidden="true" />
  )

  return (
    <SidebarProvider className="h-svh flex-col">
      <WorkspaceDockProvider
        workspaceId={activeWorkspaceId ?? 'workspace-shell'}
      >
        {activeWorkspaceId ? (
          <WorkspaceIdProvider wsId={activeWorkspaceId}>
            <ChatRuntimeProvider>
              <WorkspaceDockTitlebar
                title={titleNode}
                subtitle={subtitleNode}
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
              <SettingsDialog />
            </ChatRuntimeProvider>
          </WorkspaceIdProvider>
        ) : (
          <>
            <WorkspaceDockTitlebar
              title={titleNode}
              subtitle={subtitleNode}
            />
            <div className="relative flex min-h-0 flex-1 overflow-hidden bg-background">
              <SidebarInset className="relative overflow-hidden">
                <div className="relative flex min-h-0 flex-1 overflow-hidden">
                  {isRestoringWorkspace ? (
                    <WorkspaceLoadingSkeleton />
                  ) : (
                    <WorkspaceSetupState />
                  )}
                </div>
              </SidebarInset>
            </div>
          </>
        )}
      </WorkspaceDockProvider>

      <OnboardingOverlay
        open={needsOnboarding}
        onComplete={markOnboardingCompleted}
      />
    </SidebarProvider>
  )
}
