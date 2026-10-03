import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
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
import { useSettingsDialogStore } from '@/features/settings'
import { memberListOptions } from '@/lib/workspace/queries'
import { teamListOptions, teamMemberListOptions } from '../queries'
import { CreateTeamDialog } from './create-team-dialog'
import { TeamSummaryCard } from './team-summary-card'
import {
  DeleteTeamDialog,
  EditTeamDialog,
  TransferOwnerDialog,
} from './team-dialogs'

function TeamCard({
  team,
  onEdit,
  onTransfer,
  onDelete,
}: {
  team: TeamSummary
  onEdit: (team: TeamSummary) => void
  onTransfer: (team: TeamSummary) => void
  onDelete: (team: TeamSummary) => void
}) {
  return (
    <div className="group relative flex min-h-[196px] flex-col justify-between gap-12 rounded-xl border-[0.5px] border-border-default bg-background-main-default p-4 transition-shadow hover:shadow-float-2">
      <div className="flex flex-col gap-2">
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
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onEdit(team)}>
                    Edit Team
                  </DropdownMenuItem>
                  {team.can_transfer_owner ? (
                    <DropdownMenuItem onClick={() => onTransfer(team)}>
                      Transfer ownership
                    </DropdownMenuItem>
                  ) : null}
                  {team.can_transfer_owner ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => onDelete(team)}
                      >
                        <Trash2 className="size-4" />
                        Delete Team
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
        <span className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-pill bg-background-main-default">
            <Users className="size-4 text-icon-neutral-secondary" />
          </span>
          <span className="text-sm text-text-secondary">
            {team.member_count}{' '}
            {team.member_count === 1 ? 'member' : 'members'}
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
 * Teams overview, matched to the Penpot admin design: a secondary-surface
 * shell holding the in-card create action, workspace summary cards with
 * trailing actions, and the Team grid. Members see the same shell and grid
 * without management controls or workspace-wide summary counts.
 */
export function TeamOverview() {
  const wsId = useWorkspaceId()
  const navigate = useNavigate()
  const currentUserId = useAuthStore((s) => s.user?.id)
  const openSettingsDialog = useSettingsDialogStore((s) => s.openSettings)
  const [createOpen, setCreateOpen] = useState(false)
  const [editTeam, setEditTeam] = useState<TeamSummary | null>(null)
  const [transferTeam, setTransferTeam] = useState<TeamSummary | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<TeamSummary | null>(null)

  const { data: teams } = useSuspenseQuery(teamListOptions(wsId))
  const { data: members } = useQuery(memberListOptions(wsId))
  const { data: transferMembers } = useQuery({
    ...teamMemberListOptions(wsId, transferTeam?.id ?? ''),
    enabled: Boolean(transferTeam),
  })

  const currentMemberRole =
    members?.find((member) => member.user_id === currentUserId)?.role ?? null
  const canManage = currentMemberRole === 'owner' || currentMemberRole === 'admin'

  const totalMembers = teams.reduce((sum, team) => sum + team.member_count, 0)
  const totalIssues = teams.reduce((sum, team) => sum + team.issue_count, 0)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader className="gap-1.5">
        <span className="text-sm font-medium">Teams</span>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[80rem] flex-col gap-4 px-6 py-6">
          <header className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-semibold tracking-tight">Teams</h1>
              <p className="text-base text-text-secondary">
                {canManage
                  ? 'See teams within your organisation'
                  : 'Teams you belong to'}
              </p>
            </div>
            {canManage ? (
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  className="h-10 rounded-md px-3 shadow-1"
                  disabled
                >
                  Manage Teams
                </Button>
                <Button
                  className="h-10 gap-2 rounded-md px-3"
                  onClick={() => setCreateOpen(true)}
                >
                  <Plus className="size-4" />
                  Create a Team
                </Button>
              </div>
            ) : null}
          </header>

          <div className="flex flex-col gap-6 rounded-xl bg-background-main-secondary p-10">
            {teams.length === 0 ? (
              <div className="flex min-h-[18rem] flex-col items-center justify-center gap-4 text-center">
                <Users className="size-6 text-icon-neutral-default" />
                <div className="flex flex-col gap-1">
                  <span className="text-sm">No Teams yet</span>
                  <span className="text-xs text-text-secondary">
                    {canManage
                      ? 'Create a Team and add members to get started.'
                      : "You aren't part of any Team yet. Ask a workspace admin to add you."}
                  </span>
                </div>
              </div>
            ) : (
              <>
                {canManage ? (
                  <>
                    <div className="flex gap-4">
                      <TeamSummaryCard label="Total Teams" value={teams.length} />
                      <TeamSummaryCard
                        label="Total Members"
                        value={totalMembers}
                        action={
                          <Button
                            variant="outline"
                            className="h-10 rounded-md px-3 shadow-1"
                            onClick={() => openSettingsDialog('members')}
                          >
                            See members
                          </Button>
                        }
                      />
                      <TeamSummaryCard
                        label="Total Issues"
                        value={totalIssues}
                        action={
                          <Button
                            variant="outline"
                            className="h-10 rounded-md px-3 shadow-1"
                            onClick={() =>
                              void navigate({ to: '/teams/issues' })
                            }
                          >
                            See issues
                          </Button>
                        }
                      />
                    </div>
                    <div
                      aria-hidden
                      className="h-px w-full shrink-0 bg-border-default"
                    />
                  </>
                ) : null}

                <section className="flex flex-col gap-4">
                  <h2 className="text-xl">All teams</h2>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {teams.map((team) => (
                      <TeamCard
                        key={team.id}
                        team={team}
                        onEdit={setEditTeam}
                        onTransfer={setTransferTeam}
                        onDelete={setDeleteTarget}
                      />
                    ))}
                  </div>
                </section>
              </>
            )}
          </div>
        </div>
      </div>

      {createOpen ? (
        <CreateTeamDialog onClose={() => setCreateOpen(false)} />
      ) : null}
      {editTeam ? (
        <EditTeamDialog team={editTeam} onClose={() => setEditTeam(null)} />
      ) : null}
      {transferTeam ? (
        <TransferOwnerDialog
          team={transferTeam}
          members={transferMembers ?? []}
          onClose={() => setTransferTeam(null)}
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
