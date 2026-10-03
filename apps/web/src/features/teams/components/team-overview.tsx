import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useWorkspaceId } from '@garden/app-state/hooks'
import { useAuthStore } from '@garden/app-state/auth'
import { Plus, Users } from 'lucide-react'
import { Button } from '@garden/ui/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@garden/ui/components/ui/empty'
import { PageHeader } from '@/features/layout/page-header'
import { memberListOptions } from '@/lib/workspace/queries'
import { teamListOptions } from '../queries'
import { CreateTeamDialog } from './create-team-dialog'
import { teamColor } from './team-tokens'

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3 rounded-xl bg-background-main-default p-4">
      <span className="text-sm text-text-secondary">{label}</span>
      <span className="text-3xl font-semibold tracking-tight">{value}</span>
    </div>
  )
}

/**
 * Teams overview. Workspace owners/admins see every Team with workspace
 * summary counts; normal members see only Teams they belong to (the API
 * already filters) and no management controls.
 */
export function TeamOverview() {
  const wsId = useWorkspaceId()
  const currentUserId = useAuthStore((s) => s.user?.id)
  const [createOpen, setCreateOpen] = useState(false)

  const { data: teams } = useSuspenseQuery(teamListOptions(wsId))
  const { data: members } = useQuery(memberListOptions(wsId))
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
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-6">
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
                <Button variant="outline" disabled>
                  Manage Teams
                </Button>
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus className="size-4" />
                  Create a Team
                </Button>
              </div>
            ) : null}
          </header>

          {teams.length === 0 ? (
            <div className="rounded-2xl bg-background-main-secondary p-6">
              <Empty className="py-16">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Users className="size-5" />
                  </EmptyMedia>
                  <EmptyTitle>No Teams yet</EmptyTitle>
                  <EmptyDescription>
                    {canManage
                      ? 'Create a Team and add members to get started.'
                      : "You aren't part of any Team yet. Ask a workspace admin to add you."}
                  </EmptyDescription>
                </EmptyHeader>
                {canManage ? (
                  <EmptyContent>
                    <Button onClick={() => setCreateOpen(true)}>
                      <Plus className="size-4" />
                      Create a Team
                    </Button>
                  </EmptyContent>
                ) : null}
              </Empty>
            </div>
          ) : (
            <>
              {canManage ? (
                <div className="flex gap-4">
                  <SummaryCard label="Total Teams" value={teams.length} />
                  <SummaryCard label="Total Members" value={totalMembers} />
                  <SummaryCard label="Total Issues" value={totalIssues} />
                </div>
              ) : null}

              <section className="flex flex-col gap-4">
                <h2 className="text-xl">All teams</h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {teams.map((team) => (
                    <Link
                      key={team.id}
                      to="/teams/$teamId"
                      params={{ teamId: team.id }}
                      className="flex flex-col justify-between gap-6 rounded-2xl bg-background-main-default p-4 transition-colors hover:bg-background-main-secondary"
                    >
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            className="size-2.5 rounded-full"
                            style={{ background: teamColor(team.id) }}
                          />
                          <span className="truncate text-base font-medium">
                            {team.name}
                          </span>
                        </div>
                        <p className="line-clamp-2 min-h-10 text-sm text-text-secondary">
                          {team.description ?? 'No description'}
                        </p>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-text-secondary">
                          {team.member_count}{' '}
                          {team.member_count === 1 ? 'member' : 'members'}
                        </span>
                        <span className="text-sm font-medium text-text-brand-secondary">
                          View all
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </div>

      {createOpen ? (
        <CreateTeamDialog onClose={() => setCreateOpen(false)} />
      ) : null}
    </div>
  )
}
