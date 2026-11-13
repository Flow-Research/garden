import { createFileRoute } from '@tanstack/react-router'
import { DashboardPage } from '@/features/dashboard'
import {
  GithubIdentityNotice,
  type GithubIdentityOutcome,
} from '@/features/settings/components/github-identity-notice'
import {
  dashboardActivityOptions,
  dashboardDistributionOptions,
  dashboardOverviewOptions,
  dashboardResourcesOptions,
} from '@/features/dashboard/dashboard.queries'
import { prefetchActiveWorkspace } from '@/lib/navigation/prefetch'

export const Route = createFileRoute('/_authenticated/_app/home')({
  // workspace_id arrives from invitation-accept redirects so auth can select
  // the right organization; not consumed by the dashboard itself.
  // github_identity arrives from the "Link with GitHub" callback
  // (routes/api/github/identity/complete.ts).
  validateSearch: (search) => {
    const out: {
      workspace_id?: string
      github_identity?: GithubIdentityOutcome
    } = {}
    if (typeof search.workspace_id === 'string')
      out.workspace_id = search.workspace_id
    if (
      search.github_identity === 'linked' ||
      search.github_identity === 'taken' ||
      search.github_identity === 'failed'
    )
      out.github_identity = search.github_identity
    return out
  },
  loader: ({ context }) =>
    prefetchActiveWorkspace(context.queryClient, (workspaceId) => [
      dashboardOverviewOptions(workspaceId),
      dashboardDistributionOptions(workspaceId),
      dashboardActivityOptions(workspaceId),
      dashboardResourcesOptions(workspaceId),
    ]),
  component: HomeRoute,
})

function HomeRoute() {
  const { github_identity } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <>
      {github_identity ? (
        <GithubIdentityNotice
          outcome={github_identity}
          onDismiss={() => void navigate({ search: {}, replace: true })}
        />
      ) : null}
      <DashboardPage />
    </>
  )
}
