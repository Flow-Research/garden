import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useSuspenseQueries } from '@tanstack/react-query'
import { useWorkspaceId } from '@garden/app-state/hooks'
import { useAuthStore } from '@garden/app-state/auth'
import type { TeamMember } from '@garden/core/types'
import {
  ChevronRight,
  MoreHorizontal,
  Plus,
  Trash2,
  UserPlus,
} from 'lucide-react'
import { Badge } from '@garden/ui/components/ui/badge'
import { Button } from '@garden/ui/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@garden/ui/components/ui/dropdown-menu'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@garden/ui/components/ui/tabs'
import { toast } from 'sonner'
import { ActorAvatar } from '@/features/common/actor-avatar'
import { PageHeader } from '@/features/layout/page-header'
import { CreateIssueModal } from '@/features/modals/create-issue'
import { WorkspaceAvatar } from '@/features/workspace/workspace-avatar'
import { useWorkspaceStore } from '@garden/app-state/workspace'
import { useRemoveTeamMember } from '../mutations'
import {
  teamDetailOptions,
  teamIssueListOptions,
  teamMemberListOptions,
} from '../queries'
import {
  AddTeamMemberDialog,
  DeleteTeamDialog,
  EditTeamDialog,
  TransferOwnerDialog,
} from './team-dialogs'
import { TeamIssuesPanel } from './team-issues-panel'
import { teamColor } from './team-tokens'

export type TeamTab = 'members' | 'issues' | 'tasks'

function SummaryCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3 rounded-xl bg-background-main-default p-4">
      <span className="text-sm text-text-secondary">{label}</span>
      <span className="truncate text-3xl font-semibold tracking-tight">
        {value}
      </span>
    </div>
  )
}

function memberRoleLabel(member: TeamMember, ownerUserId: string) {
  if (member.member_type === 'agent') return 'Agent'
  if (member.user_id === ownerUserId) return 'Owner'
  return member.workspace_role === 'admin' ? 'Admin' : 'Member'
}

/**
 * Team detail with Members / Issues / Tasks tabs. Controls render from the
 * server-computed `can_manage` / `can_transfer_owner` flags; the API remains
 * the authorization boundary.
 */
export function TeamDetail({
  teamId,
  tab,
  onTabChange,
}: {
  teamId: string
  tab: TeamTab
  onTabChange: (tab: TeamTab) => void
}) {
  const wsId = useWorkspaceId()
  const navigate = useNavigate()
  const workspace = useWorkspaceStore((s) => s.workspace)
  const currentUserId = useAuthStore((s) => s.user?.id ?? '')

  const [{ data: team }, { data: members }, { data: issues }] =
    useSuspenseQueries({
      queries: [
        teamDetailOptions(wsId, teamId),
        teamMemberListOptions(wsId, teamId),
        teamIssueListOptions(wsId, teamId),
      ],
    })

  const [createIssueOpen, setCreateIssueOpen] = useState(false)
  const [createIssueData, setCreateIssueData] = useState<Record<
    string,
    unknown
  > | null>(null)
  const [addMemberOpen, setAddMemberOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const removeMember = useRemoveTeamMember()

  const canAssignOthers =
    team.can_manage || team.owner_user_id === currentUserId
  const openCreateIssue = (data?: Record<string, unknown> | null) => {
    setCreateIssueData({
      team_id: team.id,
      ...(canAssignOthers ? {} : { lock_assignee_user_id: currentUserId }),
      ...data,
    })
    setCreateIssueOpen(true)
  }

  const handleRemoveMember = async (member: TeamMember) => {
    try {
      await removeMember.mutateAsync({
        teamId: team.id,
        membershipId: member.id,
      })
      toast.success(`${member.name} removed from the Team`)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to remove member',
      )
    }
  }

  const statusCounts = {
    todo: issues.filter((issue) => issue.status === 'todo').length,
    in_progress: issues.filter((issue) => issue.status === 'in_progress').length,
    done: issues.filter((issue) => issue.status === 'done').length,
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader className="gap-1.5">
        <WorkspaceAvatar name={workspace?.name ?? 'W'} size="sm" />
        <span className="text-sm text-text-secondary">
          {workspace?.name ?? 'Workspace'}
        </span>
        <ChevronRight className="size-3 text-text-secondary" />
        <Link to="/teams" className="text-sm text-text-secondary hover:underline">
          Teams
        </Link>
        <ChevronRight className="size-3 text-text-secondary" />
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <span
            className="size-2 rounded-full"
            style={{ background: teamColor(team.id) }}
          />
          {team.name}
        </span>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col gap-5 px-6 py-5">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-semibold tracking-tight">
                {team.name}
              </h1>
              <p className="text-base text-text-secondary">
                {team.description ?? 'No description'}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Button onClick={() => openCreateIssue(null)}>
                <Plus className="size-4" />
                New Issue
              </Button>
              {team.can_manage ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button variant="outline" size="icon" aria-label="Team actions" />
                    }
                  >
                    <MoreHorizontal className="size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setEditOpen(true)}>
                      Edit Team
                    </DropdownMenuItem>
                    {team.can_transfer_owner ? (
                      <DropdownMenuItem onClick={() => setTransferOpen(true)}>
                        Transfer ownership
                      </DropdownMenuItem>
                    ) : null}
                    {team.can_transfer_owner ? (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => setDeleteOpen(true)}
                        >
                          <Trash2 className="size-4" />
                          Delete Team
                        </DropdownMenuItem>
                      </>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          </header>

          <Tabs
            value={tab}
            onValueChange={(value) => onTabChange(value as TeamTab)}
            className="flex min-h-0 flex-1 flex-col gap-4"
          >
            <TabsList variant="line" className="w-fit">
              <TabsTrigger value="members">Members</TabsTrigger>
              <TabsTrigger value="issues">Issues</TabsTrigger>
              <TabsTrigger value="tasks">Tasks</TabsTrigger>
            </TabsList>

            <TabsContent value="members" className="flex flex-col gap-4">
              <div className="flex gap-4">
                <SummaryCard label="Total members" value={team.member_count} />
                <SummaryCard label="Assigned issues" value={team.issue_count} />
              </div>

              <section className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg">Members</h2>
                  {team.can_manage ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setAddMemberOpen(true)}
                    >
                      <UserPlus className="size-4" />
                      Add member
                    </Button>
                  ) : null}
                </div>
                <ul className="divide-y rounded-xl border">
                  {members.map((member) => (
                    <li
                      key={member.id}
                      className="flex items-center gap-3 px-4 py-3"
                    >
                      <ActorAvatar
                        actorType={member.member_type}
                        actorId={(member.user_id ?? member.agent_id) ?? ''}
                        size={32}
                      />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium">
                          {member.name}
                        </span>
                        <span className="truncate text-xs text-text-secondary">
                          {member.email ?? 'Agent'}
                        </span>
                      </div>
                      <span className="w-24 text-sm text-text-secondary">
                        {member.assigned_issue_count} assigned
                      </span>
                      <Badge variant="secondary">
                        {memberRoleLabel(member, team.owner_user_id)}
                      </Badge>
                      {team.can_manage &&
                      member.user_id !== team.owner_user_id ? (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Remove ${member.name}`}
                          onClick={() => handleRemoveMember(member)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            </TabsContent>

            <TabsContent value="issues" className="flex min-h-0 flex-1 flex-col">
              <div className="flex gap-4 pb-4">
                <SummaryCard label="Todo" value={statusCounts.todo} />
                <SummaryCard
                  label="In Progress"
                  value={statusCounts.in_progress}
                />
                <SummaryCard label="Done" value={statusCounts.done} />
              </div>
              <TeamIssuesPanel
                issues={issues}
                initialView="list"
                onCreateIssue={openCreateIssue}
              />
            </TabsContent>

            <TabsContent value="tasks" className="flex min-h-0 flex-1 flex-col">
              <div className="flex gap-4 pb-4">
                <SummaryCard label="Todo" value={statusCounts.todo} />
                <SummaryCard
                  label="In Progress"
                  value={statusCounts.in_progress}
                />
                <SummaryCard label="Done" value={statusCounts.done} />
              </div>
              <TeamIssuesPanel
                issues={issues}
                initialView="board"
                onCreateIssue={openCreateIssue}
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {createIssueOpen ? (
        <CreateIssueModal
          onClose={() => {
            setCreateIssueOpen(false)
            setCreateIssueData(null)
          }}
          data={createIssueData}
        />
      ) : null}
      {addMemberOpen ? (
        <AddTeamMemberDialog
          teamId={team.id}
          existing={members}
          onClose={() => setAddMemberOpen(false)}
        />
      ) : null}
      {editOpen ? (
        <EditTeamDialog team={team} onClose={() => setEditOpen(false)} />
      ) : null}
      {transferOpen ? (
        <TransferOwnerDialog
          team={team}
          members={members}
          onClose={() => setTransferOpen(false)}
        />
      ) : null}
      {deleteOpen ? (
        <DeleteTeamDialog
          team={team}
          onClose={() => setDeleteOpen(false)}
          onDeleted={() => {
            setDeleteOpen(false)
            void navigate({ to: '/teams' })
          }}
        />
      ) : null}
    </div>
  )
}
