import { useCallback, useMemo, useState } from 'react'
import { Link, Navigate } from '@tanstack/react-router'
import { useQuery, useSuspenseQueries } from '@tanstack/react-query'
import { useWorkspaceId } from '@garden/app-state/hooks'
import { useAuthStore } from '@garden/app-state/auth'
import { ViewStoreProvider } from '@garden/app-state/issues/stores/view-store-context'
import type { IssueStatus } from '@garden/core/types'
import { BOARD_STATUSES } from '@garden/core/issues/config'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@garden/ui/components/ui/empty'
import { ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { BoardView } from '@/features/issues/components/board-view'
import { ListView } from '@/features/issues/components/list-view'
import { PageHeader } from '@/features/layout/page-header'
import { useUpdateIssue } from '@/lib/issues/mutations'
import { memberListOptions } from '@/lib/workspace/queries'
import { allTeamIssuesOptions, teamListOptions } from '../queries'
import { teamIssueViewStore } from '../view-store'
import { teamColor } from './team-tokens'

type TeamWorkMode = 'issues' | 'tasks'

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3 rounded-xl bg-background-main-default p-4">
      <span className="text-sm text-text-secondary">{label}</span>
      <span className="text-3xl font-semibold tracking-tight">{value}</span>
    </div>
  )
}

/**
 * Admin-only cross-team work surface backing the sidebar Teams dropdown:
 * Teams › Issues renders the grouped list, Teams › Tasks the kanban board.
 * Summary cards show workspace-wide Team totals (per the design); the Team
 * pills filter the content below to one Team at a time.
 */
export function TeamWorkPage({ mode }: { mode: TeamWorkMode }) {
  const wsId = useWorkspaceId()
  const currentUserId = useAuthStore((s) => s.user?.id ?? '')
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null)
  const [viewReady, setViewReady] = useState(false)
  const updateIssueMutation = useUpdateIssue()

  const { data: members } = useQuery(memberListOptions(wsId))
  const [{ data: allIssues }, { data: teams }] = useSuspenseQueries({
    queries: [allTeamIssuesOptions(wsId), teamListOptions(wsId)],
  })

  const currentRole =
    members?.find((member) => member.user_id === currentUserId)?.role ?? null
  const isAdmin = currentRole === 'owner' || currentRole === 'admin'

  const teamById = useMemo(
    () => new Map(teams.map((team) => [team.id, team] as const)),
    [teams],
  )
  const effectiveTeam =
    teams.find((team) => team.id === selectedTeamId) ?? teams[0] ?? null

  const teamChips = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>()
    for (const issue of allIssues) {
      if (!issue.team_id) continue
      const team = teamById.get(issue.team_id)
      map.set(issue.id, {
        name: team?.name ?? 'Team',
        color: teamColor(issue.team_id),
      })
    }
    return map
  }, [allIssues, teamById])

  const filteredIssues = useMemo(
    () =>
      effectiveTeam
        ? allIssues.filter((issue) => issue.team_id === effectiveTeam.id)
        : [],
    [allIssues, effectiveTeam],
  )

  const counts = useMemo(() => {
    let todo = 0
    let inProgress = 0
    let done = 0
    for (const issue of allIssues) {
      if (issue.status === 'todo') todo += 1
      else if (issue.status === 'in_progress') inProgress += 1
      else if (issue.status === 'done') done += 1
    }
    return { todo, inProgress, done, total: allIssues.length }
  }, [allIssues])

  const doneTotal = useMemo(
    () => filteredIssues.filter((issue) => issue.status === 'done').length,
    [filteredIssues],
  )

  const handleMoveIssue = useCallback(
    (issueId: string, newStatus: IssueStatus, newPosition?: number) => {
      const viewState = teamIssueViewStore.getState()
      if (viewState.sortBy !== 'position') {
        viewState.setSortBy('position')
        viewState.setSortDirection('asc')
      }
      updateIssueMutation.mutate(
        {
          id: issueId,
          status: newStatus,
          ...(newPosition !== undefined ? { position: newPosition } : {}),
        },
        { onError: () => toast.error('Failed to move issue') },
      )
    },
    [updateIssueMutation],
  )

  // The shared team view store is persisted; force the mode this page owns on
  // first render (the same pattern the Team detail tabs use).
  if (!viewReady) {
    teamIssueViewStore.setState({ viewMode: mode === 'tasks' ? 'board' : 'list' })
    setViewReady(true)
  }

  if (!members) {
    return (
      <div className="flex-1 p-6 text-sm text-text-secondary">Loading…</div>
    )
  }
  if (!isAdmin) {
    return <Navigate to="/teams" replace />
  }

  const isIssues = mode === 'issues'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader className="gap-1.5">
        <Link to="/teams" className="text-sm text-text-secondary hover:underline">
          Teams
        </Link>
        <ChevronRight className="size-3 text-text-secondary" />
        <span className="text-sm font-medium">
          {isIssues ? 'Issues' : 'Tasks'}
        </span>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col gap-5 px-6 py-5">
          <div className="flex gap-4">
            {isIssues ? (
              <>
                <SummaryCard label="Todo" value={counts.todo} />
                <SummaryCard label="In Progress" value={counts.inProgress} />
                <SummaryCard label="Done" value={counts.done} />
              </>
            ) : (
              <>
                <SummaryCard label="Total Tasks" value={counts.total} />
                <SummaryCard label="In Progress" value={counts.inProgress} />
                <SummaryCard label="Done" value={counts.done} />
              </>
            )}
          </div>

          {teams.length === 0 ? (
            <Empty className="rounded-2xl bg-background-main-secondary py-16">
              <EmptyHeader>
                <EmptyTitle>No Teams yet</EmptyTitle>
                <EmptyDescription>
                  Create a Team to see its issues and tasks here.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-1">
                {teams.map((team) => {
                  const active = team.id === effectiveTeam?.id
                  return (
                    <button
                      key={team.id}
                      type="button"
                      onClick={() => setSelectedTeamId(team.id)}
                      className={
                        active
                          ? 'flex h-6 items-center rounded-pill bg-background-brand-tertiary px-4 text-sm text-text-brand-secondary'
                          : 'flex h-6 items-center rounded-pill bg-background-main-secondary px-4 text-sm text-text-neutral-default hover:bg-background-main-secondary-hover'
                      }
                    >
                      {team.name}
                    </button>
                  )
                })}
              </div>

              <ViewStoreProvider store={teamIssueViewStore}>
                <div className="flex min-h-0 flex-1 flex-col">
                  {isIssues ? (
                    <ListView
                      issues={filteredIssues}
                      visibleStatuses={BOARD_STATUSES}
                      teamChips={teamChips}
                      doneTotal={doneTotal}
                    />
                  ) : (
                    <BoardView
                      issues={filteredIssues}
                      allIssues={filteredIssues}
                      visibleStatuses={BOARD_STATUSES}
                      hiddenStatuses={[]}
                      onMoveIssue={handleMoveIssue}
                      doneTotal={doneTotal}
                    />
                  )}
                </div>
              </ViewStoreProvider>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
