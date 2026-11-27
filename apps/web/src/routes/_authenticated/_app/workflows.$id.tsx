import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { AutomationDetailPage } from '@/features/automations'
import { useWorkspaceStore } from '@garden/app-state/workspace'

export const Route = createFileRoute('/_authenticated/_app/workflows/$id')({
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
    void navigate({ to: '/workflows' })
  }

  return (
    <AutomationDetailPage
      automationId={params.id}
      onBack={backToList}
      onDeleted={backToList}
    />
  )
}
