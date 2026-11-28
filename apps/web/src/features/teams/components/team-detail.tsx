import { useDeferredValue, useMemo, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useSuspenseQueries, useSuspenseQuery } from '@tanstack/react-query'
import { useWorkspaceId } from '@garden/app-state/hooks'
import { useAuthStore } from '@garden/app-state/auth'
import { ViewStoreProvider } from '@garden/app-state/issues/stores/view-store-context'
import type { TeamMember } from '@garden/core/types'
import {
  Copy,
  Eye,
  FolderGit2,
  Funnel,
  MoreHorizontal,
  Settings,
  Trash2,
  TriangleAlert,
  Users,
} from 'lucide-react'
import { Button } from '@garden/ui/components/ui/button'
import { cn } from '@garden/ui/lib/utils'
import { ConfirmDialog } from '@garden/ui/components/common/confirm-dialog'
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
  TransferOwnerPopover,
} from './team-dialogs'
import { TeamAgentPolicySheet } from './team-agent-policy-sheet'
import { TeamIssuesPanel } from './team-issues-panel'
import { TeamMembersPanel } from './team-members-panel'
import { TeamRepositoriesPanel } from './team-repositories-panel'
import { memberRoleLabel, type MemberRoleLabel } from './team-members-table'
import { StatusIcon } from '@/features/issues/components/status-icon'
import { TeamSummaryCard } from './team-summary-card'
import {
  ExportDataButton,
  IssuesToolbar,
  SearchField,
  TEAM_TAB_TRIGGER_CLASS,
  TEAM_TABS_LIST_CLASS,
  TOOLBAR_BUTTON_CLASS,
} from './team-tab-toolbar'
import { teamColor } from './team-tokens'

export type TeamTab = 'members' | 'issues' | 'repositories'

/** Route `validateSearch` for Team detail pages: keeps a known `tab` only. */
export function validateTeamSearch(search: Record<string, unknown>) {
  const out: { tab?: TeamTab } = {}
  if (
    search.tab === 'members' ||
    search.tab === 'issues' ||
    search.tab === 'repositories'
  ) {
    out.tab = search.tab
  }
  return out
}

type MemberRoleFilter = 'all' | MemberRoleLabel

const ROLE_FILTERS: readonly MemberRoleLabel[] = [
  'Team Owner',
  'Admin',
  'Member',
  'Agent',
]

const TAB_ITEMS: readonly {
  value: TeamTab
  label: string
  icon: typeof Users
}[] = [
  { value: 'members', label: 'Members', icon: Users },
  { value: 'issues', label: 'Issues', icon: TriangleAlert },
  { value: 'repositories', label: 'Repositories', icon: FolderGit2 },
]

/** Quotes one CSV cell so commas, quotes and newlines survive. */
const csvCell = (value: string | number) =>
  `"${String(value).replaceAll('"', '""')}"`

/**
 * Builds the Export Data CSV for the member rows currently on screen. Before,
 * Export Data was a disabled placeholder; now it exports exactly the
 * searched and filtered table the design shows, with the same columns.
 */
export function membersToCsv(members: TeamMember[], ownerUserId: string) {
  const rows = members.map((member) =>
    [
      member.name,
      member.email ?? '',
      memberRoleLabel(member, ownerUserId),
      member.assigned_issue_count,
    ]
      .map(csvCell)
      .join(','),
  )
  return [['User', 'Email', 'Role', 'Assigned Tasks'].join(','), ...rows].join(
    '\n',
  )
}

/** Hands the CSV to the browser as a file download. */
function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

/** Members toolbar from design 30: search, role filter, Export Data. */
function MembersToolbar({
  onSearchChange,
  onRoleChange,
  onExport,
  role,
  search,
}: {
  onSearchChange: (value: string) => void
  onRoleChange: (role: MemberRoleFilter) => void
  onExport: () => void
  role: MemberRoleFilter
  search: string
}) {
  return (
    <div className="flex w-full min-w-0 flex-wrap items-center gap-2 @2xl:w-auto">
      <SearchField
        label="Search members"
        onChange={onSearchChange}
        placeholder="Search for anything..."
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
        <DropdownMenuContent align="start" className="w-44">
          <DropdownMenuRadioGroup
            onValueChange={(value) => onRoleChange(value as MemberRoleFilter)}
            value={role}
          >
            <DropdownMenuRadioItem value="all">All roles</DropdownMenuRadioItem>
            {ROLE_FILTERS.map((label) => (
              <DropdownMenuRadioItem key={label} value={label}>
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <ExportDataButton onExport={onExport} />
    </div>
  )
}

/** Status summary cards for the Issues tab (Backlog maps to Todo). */
function StatusCards({
  counts,
}: {
  counts: { todo: number; in_progress: number; done: number }
}) {
  return (
    <div className="grid grid-cols-1 gap-3 @lg:grid-cols-3">
      <TeamSummaryCard
        icon={<StatusIcon status="todo" className="size-4.5" />}
        label="Todo"
        value={counts.todo}
      />
      <TeamSummaryCard
        icon={<StatusIcon status="in_progress" className="size-4.5" />}
        label="In Progress"
        value={counts.in_progress}
      />
      <TeamSummaryCard
        icon={<StatusIcon status="done" className="size-4.5" />}
        label="Done"
        value={counts.done}
      />
    </div>
  )
}

/**
 * Team detail card, matched to designs 30–33: the Team title and description with Add a team member, Setup
 * Owner and ⋯ (View details / Team settings / Copy link / Delete team), a
 * hairline, the per-tab toolbar, then the tab content. Before, the header
 * sat outside any card with an "Owner: name" button and Edit / Agent policy
 * menu items. The Members / Issues / Repositories pills are not in the
 * design; they stay right-aligned on the toolbar row so Issues and
 * Repositories remain reachable. Controls render from the server-computed
 * `can_manage` / `can_transfer_owner` flags; the API stays the authority.
 * Shared by `/teams/$teamId` and Settings › User Management, which each
 * supply their own breadcrumb and surroundings.
 */
export function TeamDetailCard({
  teamId,
  tab,
  onTabChange,
  onDeleted,
  showTabs = true,
  className,
}: {
  teamId: string
  tab: TeamTab
  onTabChange: (tab: TeamTab) => void
  /** Where to go once the Team is deleted; its detail page no longer exists. */
  onDeleted: () => void
  /**
   * Members / Issues / Repositories pills. Settings hides them and shows the
   * Members view only.
   */
  showTabs?: boolean
  className?: string
}) {
  const wsId = useWorkspaceId()
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
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [agentPolicyOpen, setAgentPolicyOpen] = useState(false)
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

  const [memberToRemove, setMemberToRemove] = useState<TeamMember | null>(null)
  /** Removes after confirmation; rejects so the confirm dialog stays open. */
  const handleRemoveMember = (member: TeamMember) =>
    removeMember.mutateAsync({ teamId: team.id, membershipId: member.id }).then(
      () => {
        toast.success(`${member.name} removed from the team`)
      },
      (error: unknown) => {
        toast.error(
          error instanceof Error ? error.message : 'Failed to remove member',
        )
        throw error
      },
    )

  const copyLink = () =>
    navigator.clipboard.writeText(window.location.href).then(
      () => toast.success('Link copied'),
      () => toast.error('Could not copy the link'),
    )

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

  const statusCounts = {
    todo: issues.filter((issue) => issue.status === 'todo').length,
    in_progress: issues.filter((issue) => issue.status === 'in_progress')
      .length,
    done: issues.filter((issue) => issue.status === 'done').length,
  }

  return (
    <>
      <div
        className={cn(
          // @container: summary cards and the toolbar size by this card's width,
          // not the viewport, since the app sidebar narrows it on tablets.
          '@container flex flex-col rounded-xl bg-background-main-default p-6',
          className,
        )}
      >
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-3">
            <h1 className="text-base">{team.name}</h1>
            <p className="text-sm text-text-secondary">
              {team.description ?? 'No description'}
            </p>
          </div>
          {team.can_manage ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                className="h-10 rounded-md px-3"
                onClick={() => setAddMemberOpen(true)}
              >
                Add a team member
              </Button>
              {team.can_transfer_owner ? (
                <TransferOwnerPopover members={members} team={team} />
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      aria-label="Team actions"
                      className="size-10 rounded-md shadow-1"
                      size="icon"
                      variant="outline"
                    />
                  }
                >
                  <MoreHorizontal className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-42">
                  <DropdownMenuItem onClick={() => setEditOpen(true)}>
                    <Eye className="size-4" />
                    View details
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setAgentPolicyOpen(true)}>
                    <Settings className="size-4" />
                    Team settings
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void copyLink()}>
                    <Copy className="size-4" />
                    Copy link
                  </DropdownMenuItem>
                  {team.can_transfer_owner ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => setDeleteOpen(true)}
                      >
                        <Trash2 className="size-4" />
                        Delete team
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
          className="mt-8 h-px w-full shrink-0 bg-border-default"
        />

        <ViewStoreProvider store={teamIssueViewStore}>
          <Tabs
            className="mt-8 flex min-h-0 flex-1 flex-col gap-0"
            onValueChange={(value) => onTabChange(value as TeamTab)}
            value={tab}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              {tab === 'members' ? (
                <MembersToolbar
                  onExport={() =>
                    downloadCsv(
                      `${team.name}-members.csv`,
                      membersToCsv(visibleMembers, team.owner_user_id),
                    )
                  }
                  onRoleChange={setMemberRole}
                  onSearchChange={setMemberSearch}
                  role={memberRole}
                  search={memberSearch}
                />
              ) : tab === 'issues' ? (
                <IssuesToolbar
                  issues={issues}
                  onCreateIssue={() => openCreateIssue(null)}
                  onSearchChange={setIssueSearch}
                  search={issueSearch}
                />
              ) : (
                <span />
              )}
              {showTabs ? (
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
              ) : null}
            </div>

            <TabsContent className="mt-8 flex flex-col" value="members">
              <TeamMembersPanel
                canManage={team.can_manage}
                members={members}
                onAddMember={() => setAddMemberOpen(true)}
                onAgentSettings={() => setAgentPolicyOpen(true)}
                onRemove={setMemberToRemove}
                onSeeIssues={showTabs ? () => onTabChange('issues') : undefined}
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
                  issues={issues}
                  onCreateIssue={openCreateIssue}
                  searchQuery={issueSearch}
                  teamChips={teamChips}
                />
              </div>
            </TabsContent>

            <TabsContent className="mt-8 flex flex-col" value="repositories">
              <TeamRepositoriesPanel
                canManage={team.can_manage}
                teamId={team.id}
              />
            </TabsContent>
          </Tabs>
        </ViewStoreProvider>
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
      <TeamAgentPolicySheet
        onOpenChange={setAgentPolicyOpen}
        open={agentPolicyOpen}
        teamId={team.id}
        teamName={team.name}
      />
      {editOpen ? (
        <EditTeamDialog team={team} onClose={() => setEditOpen(false)} />
      ) : null}
      {deleteOpen ? (
        <DeleteTeamDialog
          team={team}
          onClose={() => setDeleteOpen(false)}
          onDeleted={() => {
            setDeleteOpen(false)
            onDeleted()
          }}
        />
      ) : null}
      <ConfirmDialog
        open={memberToRemove !== null}
        onOpenChange={(open) => {
          if (!open) setMemberToRemove(null)
        }}
        title={`Remove ${memberToRemove?.name ?? 'member'} from ${team.name}?`}
        description="They will no longer be a member of this team. You can add them back later."
        confirmLabel="Remove"
        pendingLabel="Removing…"
        tone="destructive"
        onConfirm={() =>
          memberToRemove
            ? handleRemoveMember(memberToRemove)
            : Promise.resolve()
        }
      />
    </>
  )
}

/** `/teams/$teamId`: top-bar breadcrumb and secondary-surface shell. */
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
  const { data: team } = useSuspenseQuery(teamDetailOptions(wsId, teamId))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader className="gap-1.5">
        <Link
          to="/teams"
          className="text-sm text-text-secondary hover:underline"
        >
          Teams
        </Link>
        <span className="text-sm text-text-tertiary">/</span>
        <span className="text-sm font-medium text-text-default">
          {team.name}
        </span>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[80rem] px-6 pt-6 pb-12">
          <div className="rounded-2xl bg-background-main-secondary p-10">
            <TeamDetailCard
              teamId={teamId}
              tab={tab}
              onTabChange={onTabChange}
              onDeleted={() => void navigate({ to: '/teams' })}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
