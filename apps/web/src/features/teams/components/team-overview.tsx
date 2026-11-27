import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useWorkspaceId } from '@garden/app-state/hooks'
import { useAuthStore } from '@garden/app-state/auth'
import { PageHeader } from '@/features/layout/page-header'
import { memberListOptions } from '@/lib/workspace/queries'
import { teamListOptions } from '../queries'
import { TeamMembersLoadError } from './team-route-error'
import { TeamMemberView } from './team-member-view'
import { TeamManagementPanel } from './team-management-panel'

/**
 * Teams overview, matched to designs 25 and 29: the shared Team management
 * panel on one secondary-surface card.
 * Members see the combined member view instead.
 */
export function TeamOverview() {
  const wsId = useWorkspaceId()
  const currentUserId = useAuthStore((s) => s.user?.id)

  const { data: teamsResponse } = useSuspenseQuery(teamListOptions(wsId))
  const teams = teamsResponse.teams
  const {
    data: members,
    isPending: membersPending,
    isError: membersError,
    refetch: refetchMembers,
  } = useQuery(memberListOptions(wsId))

  const currentMemberRole =
    members?.find((member) => member.user_id === currentUserId)?.role ?? null
  const canManage =
    currentMemberRole === 'owner' || currentMemberRole === 'admin'

  // Wait for the role query so admins never flash the member surface, and
  // distinguish pending from error so a failed query cannot spin forever.
  if (membersPending) {
    return (
      <div className="flex-1 p-6 text-sm text-text-secondary">Loading…</div>
    )
  }
  if (membersError || !members) {
    return <TeamMembersLoadError onRetry={() => void refetchMembers()} />
  }
  if (!canManage) return <TeamMemberView />

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader className="gap-1.5">
        <span className="text-sm font-medium">Teams</span>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[80rem] flex-col gap-10 px-6 py-6">
          <div className="rounded-2xl bg-background-main-secondary p-10">
            <TeamManagementPanel teams={teams} teamLink="/teams/$teamId" />
          </div>
        </div>
      </div>
    </div>
  )
}
