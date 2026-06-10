import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { WorkspaceIdProvider } from '@garden/app-state/hooks'
import { useWorkspaceStore } from '@garden/app-state/workspace'
import { AutomationDetailPage } from '@/features/automations'

export const Route = createFileRoute('/_authenticated/automations/$id')({
  component: AutomationDetailRoute,
})

function AutomationDetailRoute() {
  const params = Route.useParams()
  const navigate = useNavigate()
  const workspaceId = useWorkspaceStore((state) => state.workspace?.id ?? null)

  if (!workspaceId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Workspace not found
      </div>
    )
  }

  const backToList = () => {
    void navigate({ to: '/automations' })
  }

  return (
    <WorkspaceIdProvider wsId={workspaceId}>
      <AutomationDetailPage
        automationId={params.id}
        onBack={backToList}
        onDeleted={backToList}
      />
    </WorkspaceIdProvider>
  )
}
