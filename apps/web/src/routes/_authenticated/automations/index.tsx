import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { WorkspaceIdProvider } from '@garden/core/hooks'
import { useWorkspaceStore } from '@garden/core/workspace'
import { AutomationsPage } from '@/features/automations'

export const Route = createFileRoute('/_authenticated/automations/')({
  component: AutomationsRoute,
})

function AutomationsRoute() {
  const navigate = useNavigate()
  const workspaceId = useWorkspaceStore((state) => state.workspace?.id ?? null)

  if (!workspaceId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Workspace not found
      </div>
    )
  }

  return (
    <WorkspaceIdProvider wsId={workspaceId}>
      <AutomationsPage
        onOpenAutomation={(automation) => {
          void navigate({
            to: '/automations/$id',
            params: { id: automation.id },
          })
        }}
      />
    </WorkspaceIdProvider>
  )
}
