import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@garden/core/auth'
import { WorkspaceIdProvider } from '@garden/core/hooks'
import { useWorkspaceStore } from '@garden/core/workspace'
import { SidebarInset, SidebarProvider } from '@garden/ui/components/ui/sidebar'
import { Skeleton } from '@garden/ui/components/ui/skeleton'
import { SearchCommand } from '@/features/search'
import { ChatRuntimeProvider } from '@/features/chat/chat-runtime-provider'
import { ModalRegistry } from '@/features/modals/registry'
import { OnboardingOverlay } from '@/features/onboarding'
import { useOnboardingStore } from '@/features/onboarding'
import { SettingsDialog } from '@/features/settings'
import {
  agentListOptions,
  connectionListOptions,
  skillListOptions,
} from '@/lib/workspace/queries'
import { WorkspaceSidebar } from './sidebar'
import { WorkspaceDockProvider, WorkspaceDockView } from './workspace-dock'

/**
 * Mount-only prefetch for workspace-wide caches.
 *
 * Why this exists: the New automation dialog (and other pickers across the
 * app) need agents, skills, and connectors. Previously each consumer
 * gated its own useQuery with `enabled: open`, so the dialog itself drove
 * the cold fetch and the user watched the tools list pop in late. That
 * coupled every consumer to fetch behavior. Warming once at workspace
 * mount makes consumers pure cache readers — no surface area on them.
 *
 * Renders nothing; the useQuery calls only exist to seed the React Query
 * cache for the active workspace.
 */
function WorkspaceWarmCaches({ wsId }: { wsId: string }) {
  useQuery(agentListOptions(wsId))
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
  const workspace = useWorkspaceStore((state) => state.workspace)
  const onboardingCompleted = useOnboardingStore((state) => state.completed)
  const markOnboardingCompleted = useOnboardingStore(
    (state) => state.markCompleted,
  )

  const hasSession = Boolean(user)
  const needsOnboarding =
    hasSession && !workspace?.id && !onboardingCompleted
  const isRestoringWorkspace = hasSession && !needsOnboarding
  const activeWorkspaceId = workspace?.id ?? null

  return (
    <SidebarProvider className="h-svh">
      <WorkspaceDockProvider
        workspaceId={activeWorkspaceId ?? 'workspace-shell'}
      >
        {activeWorkspaceId ? (
          <WorkspaceIdProvider wsId={activeWorkspaceId}>
            <WorkspaceWarmCaches wsId={activeWorkspaceId} />
            <ChatRuntimeProvider>
              <WorkspaceSidebar />
              <SidebarInset className="relative overflow-hidden !my-2 !mr-2 !ml-0 !rounded-[14px] !bg-[color:var(--vellum)] backdrop-blur-xl saturate-110 shadow-[var(--shadow-hairline)]">
                <div className="relative flex min-h-0 flex-1 overflow-hidden">
                  <WorkspaceDockView />
                </div>
              </SidebarInset>
              <SearchCommand />
              <SettingsDialog />
              <ModalRegistry />
            </ChatRuntimeProvider>
          </WorkspaceIdProvider>
        ) : (
          <SidebarInset className="relative overflow-hidden !my-2 !mr-2 !ml-2 !rounded-[14px] !bg-[color:var(--vellum)] backdrop-blur-xl saturate-110 shadow-[var(--shadow-hairline)]">
            <div className="relative flex min-h-0 flex-1 overflow-hidden">
              {isRestoringWorkspace ? (
                <WorkspaceLoadingSkeleton />
              ) : (
                <WorkspaceSetupState />
              )}
            </div>
          </SidebarInset>
        )}
      </WorkspaceDockProvider>

      <OnboardingOverlay
        open={needsOnboarding}
        onComplete={markOnboardingCompleted}
      />
    </SidebarProvider>
  )
}
