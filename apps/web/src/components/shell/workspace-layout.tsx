import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@garden/app-state/auth'
import { useWorkspaceStore } from '@garden/app-state/workspace'
import { Button } from '@garden/ui/components/ui/button'
import { SidebarInset, SidebarProvider } from '@garden/ui/components/ui/sidebar'
import { Skeleton } from '@garden/ui/components/ui/skeleton'
import { SearchCommand } from '@/features/search'
import { ChatRuntimeProvider } from '@/features/chat/chat-runtime-provider'
import { CreateWorkspaceModal } from '@/features/modals/create-workspace'
import { SettingsDialog } from '@/features/settings'
import { ConnectorCallbackListener } from '@/features/connections'
import { IssueDeepLinkListener } from '@/features/issues/components/issue-deep-link-listener'
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

function WorkspaceSetupState({ onCreate }: { onCreate: () => void }) {
  return (
    <section className="flex h-full flex-1 items-center justify-center px-6">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <div className="space-y-1.5">
          <h2 className="text-sm font-medium text-foreground">
            Create a workspace
          </h2>
          <p className="text-sm text-muted-foreground">
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

export function WorkspaceLayout({
  connectorFlowId = null,
  connectorId = null,
  issueId = null,
}: {
  connectorFlowId?: string | null
  connectorId?: string | null
  issueId?: string | null
} = {}) {
  const user = useAuthStore((state) => state.user)
  const workspace = useWorkspaceStore((state) => state.workspace)
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false)

  const hasSession = Boolean(user)
  const activeWorkspaceId = workspace?.id ?? null
  // Authenticated route loader data hydrates the singleton auth/workspace stores
  // in a microtask. During that first client frame, both stores can still be
  // empty even though the workspace is loading, so show a neutral skeleton
  // instead of incorrectly asking the user to finish setup.
  const isRestoringWorkspace = !hasSession && !activeWorkspaceId

  return (
    <SidebarProvider className="h-svh">
      <WorkspaceDockProvider
        workspaceId={activeWorkspaceId ?? 'workspace-shell'}
      >
        {activeWorkspaceId ? (
          <>
            <WorkspaceWarmCaches wsId={activeWorkspaceId} />
            <ConnectorCallbackListener
              workspaceId={activeWorkspaceId}
              connectorFlowId={connectorFlowId}
              connectorId={connectorId}
            />
            <IssueDeepLinkListener
              workspaceId={activeWorkspaceId}
              issueId={issueId}
            />
            <ChatRuntimeProvider>
              <WorkspaceSidebar
                onCreateWorkspace={() => setCreateWorkspaceOpen(true)}
              />
              <SidebarInset className="relative overflow-hidden !my-2 !mr-2 !ml-0 !rounded-[14px] !bg-[color:var(--vellum)] backdrop-blur-xl saturate-110 shadow-[inset_0_0_0_0.5px_rgba(26,31,28,0.08)] dark:shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.28)]">
                <div className="relative flex min-h-0 flex-1 overflow-hidden">
                  <WorkspaceDockView />
                </div>
              </SidebarInset>
              <SearchCommand />
              <SettingsDialog />
            </ChatRuntimeProvider>
          </>
        ) : (
          <SidebarInset className="relative overflow-hidden !my-2 !mr-2 !ml-2 !rounded-[14px] !bg-[color:var(--vellum)] backdrop-blur-xl saturate-110 shadow-[inset_0_0_0_0.5px_rgba(26,31,28,0.08)] dark:shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.28)]">
            <div className="relative flex min-h-0 flex-1 overflow-hidden">
              {isRestoringWorkspace ? (
                <WorkspaceLoadingSkeleton />
              ) : (
                <WorkspaceSetupState
                  onCreate={() => setCreateWorkspaceOpen(true)}
                />
              )}
            </div>
          </SidebarInset>
        )}
      </WorkspaceDockProvider>
      {createWorkspaceOpen ? (
        <CreateWorkspaceModal onClose={() => setCreateWorkspaceOpen(false)} />
      ) : null}
    </SidebarProvider>
  )
}
