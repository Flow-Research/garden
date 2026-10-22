import { useMemo, useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useWorkspaceId } from '@garden/app-state/hooks'
import { useAuthStore } from '@garden/app-state/auth'
import { ViewStoreProvider } from '@garden/app-state/issues/stores/view-store-context'
import type { TeamSummary } from '@garden/core/types'
import { ChevronDown, Users } from 'lucide-react'
import { Button } from '@garden/ui/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@garden/ui/components/ui/dropdown-menu'
import { CreateIssueModal } from '@/features/modals/create-issue'
import { teamIssueListOptions, teamListOptions } from '../queries'
import { teamIssueViewStore } from '../view-store'
import { TeamIssuesPanel } from './team-issues-panel'
import { IssuesToolbar } from './team-tab-toolbar'
import { teamColor } from './team-tokens'

/** Member's Team selector: the design's "Member: [dot] {Team} ▾" dropdown. */
function TeamSelector({
  onSelect,
  selected,
  teams,
}: {
  onSelect: (teamId: string) => void
  selected: TeamSummary
  teams: TeamSummary[]
}) {
  // Controlled so the menu closes as soon as a Team is picked; the selection
  // also navigates (replacing the ?team= param), which re-renders in place.
  const [open, setOpen] = useState(false)

  return (
    <DropdownMenu onOpenChange={setOpen} open={open}>
      <DropdownMenuTrigger
        render={
          <Button
            className="h-8 gap-1.5 rounded-md px-3 text-sm font-normal shadow-1"
            variant="outline"
          >
            {selected.name}
            <ChevronDown className="size-4" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuRadioGroup
          onValueChange={(value) => {
            onSelect(value)
            setOpen(false)
          }}
          value={selected.id}
        >
          {teams.map((team) => (
            <DropdownMenuRadioItem key={team.id} value={team.id}>
              {team.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * The design's member empty state: a gray rounded panel with the title and
 * copy for the single Issues view. (The Penpot frames also overlay admin
 * leftovers — Roles/Guests tabs and a "Create a Department" CTA — which are
 * ignored.)
 */
function MemberEmptyState() {
  return (
    <div className="flex min-h-[431px] w-full flex-col items-center justify-center gap-2 rounded-xl bg-background-main-secondary px-6 text-center">
      <p className="text-base font-medium">No Issues</p>
      <p className="text-sm text-text-secondary">
        You don&apos;t have any issues yet. Once issues are assigned to you,
        it&apos;ll be recorded here.
      </p>
    </div>
  )
}

/**
 * Member's Team work surface: selector, description, and a single Issues view
 * whose toolbar carries the list/board toggle on the side (replacing the old
 * Issues/Tasks pill tabs).
 */
function TeamMemberWork({
  onSelectTeam,
  selected,
  teams,
}: {
  onSelectTeam: (teamId: string) => void
  selected: TeamSummary
  teams: TeamSummary[]
}) {
  const wsId = useWorkspaceId()
  const currentUserId = useAuthStore((s) => s.user?.id ?? '')
  const { data: issues } = useSuspenseQuery(
    teamIssueListOptions(wsId, selected.id),
  )
  const [issueSearch, setIssueSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)

  // The list rows carry the Team chip per the design even though the view is
  // already scoped to one Team.
  const teamChips = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>()
    for (const issue of issues) {
      if (!issue.team_id) continue
      map.set(issue.id, {
        name: selected.name,
        color: teamColor(selected.id),
      })
    }
    return map
  }, [issues, selected.id, selected.name])

  const openCreateIssue = () => setCreateOpen(true)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-[80rem] flex-col px-6 pt-12 pb-12">
          {/* Design header: the selected Team's name + description with the
              Member selector centered against the block. No breadcrumb bar. */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-1">
              <h1 className="text-2xl font-semibold tracking-tight">
                {selected.name}
              </h1>
              <p className="text-base text-text-secondary">
                {selected.description ?? 'No description'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-sm text-text-secondary">Member:</span>
              <TeamSelector
                onSelect={onSelectTeam}
                selected={selected}
                teams={teams}
              />
            </div>
          </div>

          <ViewStoreProvider store={teamIssueViewStore}>
            <div className="mt-8 flex min-h-0 flex-1 flex-col gap-0">
              <div className="flex flex-wrap items-center justify-end gap-3">
                <IssuesToolbar
                  issues={issues}
                  onCreateIssue={openCreateIssue}
                  onSearchChange={setIssueSearch}
                  search={issueSearch}
                />
              </div>

              <div className="mt-8 flex min-h-0 flex-1 flex-col">
                {issues.length === 0 ? (
                  <MemberEmptyState />
                ) : (
                  <TeamIssuesPanel
                    issues={issues}
                    onCreateIssue={openCreateIssue}
                    searchQuery={issueSearch}
                    teamChips={teamChips}
                  />
                )}
              </div>
            </div>
          </ViewStoreProvider>
        </div>
      </div>

      {createOpen ? (
        <CreateIssueModal
          data={{
            team_id: selected.id,
            lock_assignee_user_id: currentUserId,
          }}
          onClose={() => setCreateOpen(false)}
        />
      ) : null}
    </div>
  )
}

/** No-Teams fallback for members who have not been added to a Team yet. */
function NoTeamsState() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-[80rem] flex-col px-6 pt-12 pb-12">
          <h1 className="text-2xl font-semibold tracking-tight">Teams</h1>
          <div className="flex flex-1 items-center justify-center py-16">
            <div className="flex flex-col items-center gap-2 text-center">
              <Users className="size-6 text-icon-neutral-default" />
              <span className="text-sm">No Teams yet</span>
              <span className="text-xs text-text-secondary">
                You aren&apos;t part of any Team yet. Ask a workspace admin to
                add you.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Member-facing Teams surface (Penpot "Team Member (Member)"): a single page
 * with the Team selector, the selected Team's description, and one Issues view
 * (list/board toggle in the toolbar) scoped to that Team. The server already
 * limits members to issues assigned to them. Replaces the admin overview grid
 * for non-managers.
 */
export function TeamMemberView() {
  const wsId = useWorkspaceId()
  const navigate = useNavigate()
  const search = useSearch({ from: '/_authenticated/_app/teams/' })
  const { data: teams } = useSuspenseQuery(teamListOptions(wsId))

  const selected =
    teams.find((team) => team.id === search.team) ?? teams[0] ?? null
  if (!selected) return <NoTeamsState />

  return (
    <TeamMemberWork
      onSelectTeam={(teamId) =>
        void navigate({
          to: '/teams',
          search: { team: teamId },
          replace: true,
        })
      }
      selected={selected}
      teams={teams}
    />
  )
}
