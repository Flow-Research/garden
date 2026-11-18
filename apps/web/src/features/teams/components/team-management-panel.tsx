import { useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useWorkspaceId } from '@garden/app-state/hooks'
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
import { teamMemberListOptions } from '../queries'
import { CreateTeamDialog } from './create-team-dialog'
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
 * Owner/admin Team management from designs 25 and 29: the Create a Team
 * action, the "No Teams" empty state or three-column Team grid, and the
 * create, add-member and delete dialogs. Shared by the Teams overview and
 * Settings › User Management so both surfaces stay identical. `toolbar`
 * fills the left of the action row; Settings puts its sub-tab pills there.
 */
export function TeamManagementPanel({
  teams,
  toolbar,
}: {
  teams: TeamSummary[]
  toolbar?: ReactNode
}) {
  const wsId = useWorkspaceId()
  const [createOpen, setCreateOpen] = useState(false)
  const [addMemberTeam, setAddMemberTeam] = useState<TeamSummary | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<TeamSummary | null>(null)
  const { data: addMemberExisting } = useQuery({
    ...teamMemberListOptions(wsId, addMemberTeam?.id ?? ''),
    enabled: Boolean(addMemberTeam),
  })

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        {toolbar}
        <Button
          className="ml-auto h-10 rounded-md px-3"
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
