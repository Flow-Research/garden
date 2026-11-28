import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ExecutionHostsPage } from '@/features/execution-hosts/components/execution-hosts-page'

export const Route = createFileRoute(
  '/_authenticated/_app/settings/execution-hosts',
)({
  validateSearch: (search): { launch?: string } =>
    typeof search.launch === 'string' ? { launch: search.launch } : {},
  component: ExecutionHostsRoute,
})

function ExecutionHostsRoute() {
  const { launch } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  return (
    <ExecutionHostsPage
      launchId={launch}
      onOpenRun={(launchId) =>
        void navigate({
          search: (previous) => ({ ...previous, launch: launchId }),
        })
      }
    />
  )
}
