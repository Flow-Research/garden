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
  link,
  onAddMember,
  onDelete,
}: {
  team: TeamSummary
  link: TeamLink
  onAddMember: (team: TeamSummary) => void
  onDelete: (team: TeamSummary) => void
}) {
  return (
    <div className="group relative flex min-h-[196px] flex-col justify-between gap-12 rounded-xl border-[0.5px] border-border-default bg-background-main-default p-4 transition-shadow hover:shadow-float-2">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <Link
            to={link}
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
      <div className="pointer-events-none flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <Users className="size-4 shrink-0 text-icon-neutral-secondary" />
          <span className="truncate text-sm text-text-secondary">
            {team.member_count} {team.member_count === 1 ? 'member' : 'members'}
          </span>
        </span>
        <span className="inline-flex h-8 shrink-0 items-center rounded-md border border-border-default bg-background-main-default px-3 text-sm shadow-1">
          View all
        </span>
      </div>
    </div>
  )
}

/**
 * Team card grid sized by its `@container` rather than the viewport, so an
 * open sidebar or a narrow settings column drops columns instead of
 * squeezing cards. Caps at the design's three columns.
 */
export const TEAM_GRID_CLASS =
  'grid grid-cols-1 gap-4 @xl:grid-cols-2 @4xl:grid-cols-3'

/** Where a Team card opens: the Teams area or Settings › User Management. */
export type TeamLink =
  | '/teams/$teamId'
  | '/settings/user-management/teams/$teamId'

/** The Create a Team button and the Create New Team dialog it opens. */
export function CreateTeamButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        className="h-10 gap-2 rounded-md px-3"
        onClick={() => setOpen(true)}
      >
        <Plus className="size-4" />
        Create a Team
      </Button>
      {open ? <CreateTeamDialog onClose={() => setOpen(false)} /> : null}
    </>
  )
}

/**
 * The "No Teams" empty state or the Team card grid, with the add-member and
 * delete dialogs the card menus open. Wrap it in an `@container` so the grid
 * sizes by its column, not the viewport.
 */
export function TeamGrid({
  teams,
  teamLink,
}: {
  teams: TeamSummary[]
  teamLink: TeamLink
}) {
  const wsId = useWorkspaceId()
  const [addMemberTeam, setAddMemberTeam] = useState<TeamSummary | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<TeamSummary | null>(null)
  // No placeholder: the shared options keep the previous Team's members,
  // which would open the dialog filtering candidates against the wrong Team.
  // Cached members for the selected Team still return immediately.
  const { data: addMemberExisting } = useQuery({
    ...teamMemberListOptions(wsId, addMemberTeam?.id ?? ''),
    placeholderData: undefined,
    enabled: Boolean(addMemberTeam),
  })

  return (
    <>
      {teams.length === 0 ? (
        <div className="flex min-h-[14rem] flex-col items-center justify-center gap-1 px-4 pb-10 text-center">
          <Users className="mb-2 size-5 text-icon-neutral-secondary" />
          <span className="text-sm">No Teams</span>
          <span className="text-xs text-text-secondary">
            You don&apos;t have any teams. Create one and add members in.
          </span>
        </div>
      ) : (
        <div className={TEAM_GRID_CLASS}>
          {teams.map((team) => (
            <TeamCard
              key={team.id}
              team={team}
              link={teamLink}
              onAddMember={setAddMemberTeam}
              onDelete={setDeleteTarget}
            />
          ))}
        </div>
      )}
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
    </>
  )
}

/**
 * Settings › User Management Team management: `toolbar` (the sub-tab pills)
 * and Create a Team on one row over the Team grid. The `/teams` overview
 * composes `CreateTeamButton` and `TeamGrid` into its own layout.
 */
export function TeamManagementPanel({
  teams,
  teamLink,
  toolbar,
}: {
  teams: TeamSummary[]
  teamLink: TeamLink
  toolbar?: ReactNode
}) {
  return (
    <div className="@container flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        {toolbar}
        <span className="ml-auto">
          <CreateTeamButton />
        </span>
      </div>
      <TeamGrid teams={teams} teamLink={teamLink} />
    </div>
  )
}
