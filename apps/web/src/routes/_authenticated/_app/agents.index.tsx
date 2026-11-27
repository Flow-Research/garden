import { createFileRoute } from '@tanstack/react-router'
import { AgentsPage } from '@/features/agents/components'
import { useSurfaceNavigation } from '@/features/navigation/use-surface-navigation'
import { agentListOptions } from '@/lib/workspace/queries'
import { prefetchActiveWorkspace } from '@/lib/navigation/prefetch'

export const Route = createFileRoute('/_authenticated/_app/agents/')({
  loader: ({ context }) =>
    prefetchActiveWorkspace(context.queryClient, (workspaceId) => [
      agentListOptions(workspaceId),
    ]),
  component: AgentsRoute,
})

function AgentsRoute() {
  const { openAgent } = useSurfaceNavigation()
  return <AgentsPage onOpenAgent={openAgent} />
}
