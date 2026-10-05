import { useDeferredValue, useMemo, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useSuspenseQueries } from '@tanstack/react-query'
import { useWorkspaceId } from '@garden/app-state/hooks'
import { useAuthStore } from '@garden/app-state/auth'
import { ViewStoreProvider } from '@garden/app-state/issues/stores/view-store-context'
import type { TeamMember } from '@garden/core/types'
import {
  Funnel,
  ListChecks,
  MoreHorizontal,
  Trash2,
  TriangleAlert,
  Users,
} from 'lucide-react'
import { Button } from '@garden/ui/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
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
import { PageHeader } from '@/features/layout/page-header'
import { CreateIssueModal } from '@/features/modals/create-issue'
import { useRemoveTeamMember } from '../mutations'
import {
  teamDetailOptions,
  teamIssueListOptions,
  teamMemberListOptions,
} from '../queries'
import { teamIssueViewStore } from '../view-store'
import {
  AddTeamMemberDialog,
  DeleteTeamDialog,
  EditTeamDialog,
  TransferOwnerDialog,
} from './team-dialogs'
import { TeamIssuesPanel } from './team-issues-panel'
import { TeamMembersPanel } from './team-members-panel'
import { memberRoleLabel } from './team-members-table'
import { TeamSummaryCard, TeamSummaryStatusIcon } from './team-summary-card'
import {
  ExportDataButton,
  IssuesToolbar,
  SearchField,
  TEAM_TAB_TRIGGER_CLASS,
  TEAM_TABS_LIST_CLASS,
  TOOLBAR_BUTTON_CLASS,
} from './team-tab-toolbar'
import { teamColor } from './team-tokens'

export type TeamTab = 'members' | 'issues' | 'tasks'

type MemberRoleFilter = 'all' | 'Owner' | 'Admin' | 'Member' | 'Agent'

const TAB_ITEMS: readonly {
  value: TeamTab
  label: string
  icon: typeof Users
}[] = [
  { value: 'members', label: 'Members', icon: Users },
  { value: 'issues', label: 'Issues', icon: TriangleAlert },
  { value: 'tasks', label: 'Tasks', icon: ListChecks },
]

/** Members toolbar: identity search plus a role/type filter. */
function MembersToolbar({
  onSearchChange,
  onRoleChange,
  role,
  search,
}: {
  onSearchChange: (value: string) => void
  onRoleChange: (role: MemberRoleFilter) => void
  role: MemberRoleFilter
  search: string
}) {
  return (
    <div className="flex items-center gap-3">
      <SearchField
        label="Search members"
        onChange={onSearchChange}
        placeholder="Search members..."
        value={search}
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button className={TOOLBAR_BUTTON_CLASS} variant="outline">
              <Funnel className="size-4" />
              Filter
              {role !== 'all' ? (
                <span className="flex size-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
                  1
                </span>
              ) : null}
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuRadioGroup
            onValueChange={(value) => onRoleChange(value as MemberRoleFilter)}
            value={role}
          >
            <DropdownMenuRadioItem value="all">
              All roles
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="Owner">Owner</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="Admin">Admin</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="Member">Member</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="Agent">Agent</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <ExportDataButton />
    </div>
  )
}

/** Status summary cards for the Issues/Tasks tabs (Backlog maps to Todo). */
function StatusCards({
  counts,
}: {
  counts: { todo: number; in_progress: number; done: number }
}) {
  return (
    <div className="flex gap-3">
      <TeamSummaryCard
        icon={<TeamSummaryStatusIcon status="todo" />}
        label="Todo"
        value={counts.todo}
      />
      <TeamSummaryCard
        icon={<TeamSummaryStatusIcon status="in_progress" />}
        label="In Progress"
        value={counts.in_progress}
      />
      <TeamSummaryCard
        icon={<TeamSummaryStatusIcon status="done" />}
        label="Done"
        value={counts.done}
      />
    </div>
  )
}

/**
 * Team detail with Members / Issues / Tasks tabs, matched to the Penpot admin
 * design: header with Add a team member / owner display / ⋯ actions, a
 * hairline divider, pill tabs whose row also carries the per-tab search and
 * filter controls, then the tab content. Controls render from the
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
  const [memberSearch, setMemberSearch] = useState('')
  const [memberRole, setMemberRole] = useState<MemberRoleFilter>('all')
  const [issueSearch, setIssueSearch] = useState('')
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

  const deferredMemberSearch = useDeferredValue(memberSearch.trim())
  const visibleMembers = useMemo(
    () =>
      members.filter((member) => {
        if (
          memberRole !== 'all' &&
          memberRoleLabel(member, team.owner_user_id) !== memberRole
        ) {
          return false
        }
        if (!deferredMemberSearch) return true
        const haystack = `${member.name} ${member.email ?? ''}`.toLowerCase()
        return haystack.includes(deferredMemberSearch.toLowerCase())
      }),
    [members, memberRole, deferredMemberSearch, team.owner_user_id],
  )

  const teamChips = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>()
    for (const issue of issues) {
      if (!issue.team_id) continue
      map.set(issue.id, { name: team.name, color: teamColor(team.id) })
    }
    return map
  }, [issues, team.id, team.name])

  const owner = members.find(
    (member) => member.user_id === team.owner_user_id,
  )
  const ownerLabel = owner?.name ?? 'Owner'

  const statusCounts = {
    todo: issues.filter((issue) => issue.status === 'todo').length,
    in_progress: issues.filter((issue) => issue.status === 'in_progress').length,
    done: issues.filter((issue) => issue.status === 'done').length,
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader className="gap-1.5">
        <Link to="/teams" className="text-sm text-text-secondary hover:underline">
          Teams
        </Link>
        <span className="text-sm text-text-tertiary">/</span>
        <span className="text-sm font-medium text-text-default">
          {team.name}
        </span>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[80rem] flex-col px-6 pt-6 pb-12">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-2">
              <h1 className="text-base font-semibold tracking-tight">
                {team.name}
              </h1>
              <p className="text-sm text-text-secondary">
                {team.description ?? 'No description'}
              </p>
            </div>
            {team.can_manage ? (
              <div className="flex items-center gap-3">
                <Button
                  className="h-10 rounded-md px-3"
                  onClick={() => setAddMemberOpen(true)}
                >
                  Add a team member
                </Button>
                {team.can_transfer_owner ? (
                  <Button
                    className="h-10 rounded-md px-3 shadow-1"
                    onClick={() => setTransferOpen(true)}
                    variant="outline"
                  >
                    Owner: {ownerLabel}
                  </Button>
                ) : (
                  <span className="inline-flex h-10 items-center rounded-md border border-border-default px-3 text-sm text-text-secondary">
                    Owner: {ownerLabel}
                  </span>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        aria-label="Team actions"
                        className="h-10 rounded-md px-3 shadow-1"
                        variant="outline"
                      />
                    }
                  >
                    <MoreHorizontal className="size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setEditOpen(true)}>
                      Edit Team
                    </DropdownMenuItem>
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
              </div>
            ) : null}
          </header>

          <div
            aria-hidden
            className="mt-10 h-px w-full shrink-0 bg-border-default"
          />

          <ViewStoreProvider store={teamIssueViewStore}>
            <Tabs
              className="mt-10 flex min-h-0 flex-1 flex-col gap-0"
              onValueChange={(value) => onTabChange(value as TeamTab)}
              value={tab}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <TabsList className={TEAM_TABS_LIST_CLASS}>
                  {TAB_ITEMS.map((item) => (
                    <TabsTrigger
                      className={TEAM_TAB_TRIGGER_CLASS}
                      key={item.value}
                      value={item.value}
                    >
                      <item.icon className="size-4" />
                      {item.label}
                    </TabsTrigger>
                  ))}
                </TabsList>

                {tab === 'members' ? (
                  <MembersToolbar
                    onRoleChange={setMemberRole}
                    onSearchChange={setMemberSearch}
                    role={memberRole}
                    search={memberSearch}
                  />
                ) : (
                  <IssuesToolbar
                    issues={issues}
                    onCreateIssue={() => openCreateIssue(null)}
                    onSearchChange={setIssueSearch}
                    search={issueSearch}
                  />
                )}
              </div>

              <TabsContent className="mt-8 flex flex-col" value="members">
                <TeamMembersPanel
                  canManage={team.can_manage}
                  members={members}
                  onRemove={handleRemoveMember}
                  search={memberSearch}
                  team={team}
                  visibleMembers={visibleMembers}
                />
              </TabsContent>

              <TabsContent
                className="mt-8 flex min-h-0 flex-1 flex-col"
                value="issues"
              >
                <div className="flex flex-col gap-8">
                  <StatusCards counts={statusCounts} />
                  <TeamIssuesPanel
                    initialView="list"
                    issues={issues}
                    onCreateIssue={openCreateIssue}
                    searchQuery={issueSearch}
                    teamChips={teamChips}
                  />
                </div>
              </TabsContent>

              <TabsContent
                className="mt-8 flex min-h-0 flex-1 flex-col"
                value="tasks"
              >
                <div className="flex flex-col gap-8">
                  <StatusCards counts={statusCounts} />
                  <TeamIssuesPanel
                    initialView="board"
                    issues={issues}
                    onCreateIssue={openCreateIssue}
                    searchQuery={issueSearch}
                    teamChips={teamChips}
                  />
                </div>
              </TabsContent>
            </Tabs>
          </ViewStoreProvider>
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
