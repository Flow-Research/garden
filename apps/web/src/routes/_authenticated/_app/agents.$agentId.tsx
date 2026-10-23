import { createFileRoute } from '@tanstack/react-router'
import { AgentDetail } from '@/features/agents/components'
import { useSurfaceNavigation } from '@/features/navigation/use-surface-navigation'

const AGENT_TABS = new Set(['overview', 'skills', 'access'])

export const Route = createFileRoute('/_authenticated/_app/agents/$agentId')({
  // ?tab= keeps the open tab in the URL, so it can be linked and survives a
  // reload (it used to reset to Overview).
  validateSearch: (search): { tab?: string } =>
    typeof search.tab === 'string' && AGENT_TABS.has(search.tab)
      ? { tab: search.tab }
      : {},
  component: AgentDetailRoute,
})

function AgentDetailRoute() {
  const { agentId } = Route.useParams()
  const { tab } = Route.useSearch()
  const navigate = Route.useNavigate()
  const { openSkill } = useSurfaceNavigation()
  return (
    <AgentDetail
      agentId={agentId}
      onOpenSkill={openSkill}
      tab={tab ?? 'overview'}
      onTabChange={(next) =>
        void navigate({
          search: next === 'overview' ? {} : { tab: next },
          replace: true,
        })
      }
    />
  )
}
