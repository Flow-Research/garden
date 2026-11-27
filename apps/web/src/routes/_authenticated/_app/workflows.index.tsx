import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { AutomationsPage } from '@/features/automations'
import { useWorkspaceStore } from '@garden/app-state/workspace'

export const Route = createFileRoute('/_authenticated/_app/workflows/')({
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
    <AutomationsPage
      onOpenAutomation={(automation) => {
        void navigate({
          to: '/workflows/$id',
          params: { id: automation.id },
        })
      }}
    />
  )
}
