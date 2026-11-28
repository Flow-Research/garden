import { Link } from '@tanstack/react-router'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { Button, buttonVariants } from '@garden/ui/components/ui/button'
import { useSettingsDialogStore } from '@/features/settings'
import { useWorkspaceId } from '@garden/app-state/hooks'
import { useAuthStore } from '@garden/app-state/auth'
import { PageHeader } from '@/features/layout/page-header'
import { memberListOptions } from '@/lib/workspace/queries'
import { teamListOptions } from '../queries'
import { TeamMembersLoadError } from './team-route-error'
import { TeamMemberView } from './team-member-view'
import { CreateTeamButton, TeamGrid } from './team-management-panel'
import { TeamSummaryCard } from './team-summary-card'

const SUMMARY_ACTION_CLASS = 'h-8 shrink-0 rounded-md px-3 shadow-1'

/**
 * Owner/admin Teams overview: title row with Create a Team, then one
 * secondary-surface card holding the Total Teams / Members / Issues summary
 * and the Team grid. Members see the combined member view instead.
 */
export function TeamOverview() {
  const wsId = useWorkspaceId()
  const currentUserId = useAuthStore((s) => s.user?.id)

  const { data: teamsResponse } = useSuspenseQuery(teamListOptions(wsId))
  const teams = teamsResponse.teams
  const openSettings = useSettingsDialogStore((s) => s.openSettings)
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

  // Each issue belongs to at most one Team and managers see every Team, so
  // the per-Team counts sum to the workspace's Team issue total.
  const issueTotal = teams.reduce((sum, team) => sum + team.issue_count, 0)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader className="gap-1.5">
        <span className="text-sm font-medium">Teams</span>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[80rem] flex-col gap-6 px-4 py-6 sm:gap-8 sm:px-6 md:py-10">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-1">
              <h1 className="text-xl font-medium">Teams</h1>
              <p className="text-sm text-text-secondary">
                See teams within your organisation
              </p>
            </div>
            <CreateTeamButton />
          </div>

          <div className="@container flex flex-col gap-6 rounded-2xl bg-background-main-secondary p-4 sm:p-6 lg:p-10">
            {teams.length > 0 ? (
              <>
                <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-3">
                  <TeamSummaryCard
                    label="Total Teams"
                    value={teamsResponse.total}
                  />
                  <TeamSummaryCard
                    label="Total Members"
                    value={teamsResponse.unique_member_count}
                    action={
                      <Button
                        className={SUMMARY_ACTION_CLASS}
                        onClick={() => openSettings('members')}
                        variant="outline"
                      >
                        See members
                      </Button>
                    }
                  />
                  <TeamSummaryCard
                    label="Total Issues"
                    value={issueTotal}
                    action={
                      <Link
                        className={buttonVariants({
                          className: SUMMARY_ACTION_CLASS,
                          variant: 'outline',
                        })}
                        to="/teams/issues"
                      >
                        See issues
                      </Link>
                    }
                  />
                </div>
                <div aria-hidden className="h-px w-full bg-border-default" />
                <h2 className="text-lg">All teams</h2>
              </>
            ) : null}
            <TeamGrid teams={teams} teamLink="/teams/$teamId" />
          </div>
        </div>
      </div>
    </div>
  )
}
