import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useWorkspaceId } from '@garden/app-state/hooks'
import { useAuthStore } from '@garden/app-state/auth'
import { MoreVertical, Plus, Trash2, Users } from 'lucide-react'
import type { TeamSummary } from '@garden/core/types'
import { Button } from '@garden/ui/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@garden/ui/components/ui/dropdown-menu'
import { PageHeader } from '@/features/layout/page-header'
import { memberListOptions } from '@/lib/workspace/queries'
import { teamListOptions, teamMemberListOptions } from '../queries'
import { CreateTeamDialog } from './create-team-dialog'
import { TeamMembersLoadError } from './team-route-error'
import { TeamMemberView } from './team-member-view'
import { TeamInviteSettings } from './team-invite-settings'
import { AddTeamMemberDialog, DeleteTeamDialog } from './team-dialogs'

/**
 * Design 29 Team card: title and ⋮ menu, two-line description, member count
 * and a View all affordance. The menu carries only the design's two actions,
 * Add team member and Delete; editing and ownership live on the detail page.
 */
function TeamCard({
  team,
  onAddMember,
  onDelete,
}: {
  team: TeamSummary
  onAddMember: (team: TeamSummary) => void
  onDelete: (team: TeamSummary) => void
}) {
  return (
    <div className="group relative flex min-h-[196px] flex-col justify-between gap-12 rounded-xl border-[0.5px] border-border-default bg-background-main-default p-4 transition-shadow hover:shadow-float-2">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <Link
            to="/teams/$teamId"
            params={{ teamId: team.id }}
            className="truncate text-base font-semibold after:absolute after:inset-0 after:content-['']"
          >
            {team.name}
          </Link>
          {team.can_manage ? (
            <span className="relative z-10">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-icon-neutral-tertiary"
                      aria-label={`${team.name} actions`}
                    />
                  }
                >
                  <MoreVertical className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-50">
                  <DropdownMenuItem onClick={() => onAddMember(team)}>
                    <Plus className="size-4" />
                    Add team member
                  </DropdownMenuItem>
                  {team.can_transfer_owner ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => onDelete(team)}>
                        <Trash2 className="size-4" />
                        Delete
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </span>
          ) : null}
        </div>
        <p className="line-clamp-2 min-h-11 text-sm text-text-secondary">
          {team.description ?? 'No description'}
        </p>
      </div>
      <div className="pointer-events-none flex items-center justify-between">
        <span className="flex items-center gap-4">
          <Users className="size-4 text-icon-neutral-secondary" />
          <span className="text-sm text-text-secondary">
            {team.member_count} {team.member_count === 1 ? 'member' : 'members'}
          </span>
        </span>
        <span className="inline-flex h-8 items-center rounded-md border border-border-default bg-background-main-default px-3 text-sm shadow-1">
          View all
        </span>
      </div>
    </div>
  )
}

/**
 * Teams overview, matched to designs 25 and 29: one secondary-surface card
 * holding the right-aligned Create a Team action and either the "No Teams"
 * empty state or the three-column Team grid. The earlier summary row and
 * "All teams" heading are gone because the design has neither. Members see
 * the combined member view instead.
 */
export function TeamOverview() {
  const wsId = useWorkspaceId()
  const currentUserId = useAuthStore((s) => s.user?.id)
  const [createOpen, setCreateOpen] = useState(false)
  const [addMemberTeam, setAddMemberTeam] = useState<TeamSummary | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<TeamSummary | null>(null)

  const { data: teamsResponse } = useSuspenseQuery(teamListOptions(wsId))
  const teams = teamsResponse.teams
  const {
    data: members,
    isPending: membersPending,
    isError: membersError,
    refetch: refetchMembers,
  } = useQuery(memberListOptions(wsId))
  const { data: addMemberExisting } = useQuery({
    ...teamMemberListOptions(wsId, addMemberTeam?.id ?? ''),
    enabled: Boolean(addMemberTeam),
  })

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
          <div className="flex flex-col gap-8 rounded-2xl bg-background-main-secondary p-10">
            <div className="flex justify-end">
              <Button
                className="h-10 rounded-md px-3"
                onClick={() => setCreateOpen(true)}
              >
                Create a Team
              </Button>
            </div>
            {teams.length === 0 ? (
              <div className="flex min-h-[14rem] flex-col items-center justify-center gap-1 pb-20 text-center">
                <span className="text-sm">No Teams</span>
                <span className="text-xs text-text-secondary">
                  You don&apos;t have any teams. Create one and add members in.
                </span>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {teams.map((team) => (
                  <TeamCard
                    key={team.id}
                    team={team}
                    onAddMember={setAddMemberTeam}
                    onDelete={setDeleteTarget}
                  />
                ))}
              </div>
            )}
          </div>
          <TeamInviteSettings teams={teams} />
        </div>
      </div>

      {createOpen ? (
        <CreateTeamDialog onClose={() => setCreateOpen(false)} />
      ) : null}
      {addMemberTeam && addMemberExisting ? (
        <AddTeamMemberDialog
          teamId={addMemberTeam.id}
          existing={addMemberExisting}
          onClose={() => setAddMemberTeam(null)}
        />
      ) : null}
      {deleteTarget ? (
        <DeleteTeamDialog
          team={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => setDeleteTarget(null)}
        />
      ) : null}
    </div>
  )
}
