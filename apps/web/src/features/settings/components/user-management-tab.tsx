import { Suspense, type ReactNode } from 'react'
import { Link, Navigate, useNavigate } from '@tanstack/react-router'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useWorkspaceId } from '@garden/app-state/hooks'
import { useAuthStore } from '@garden/app-state/auth'
import { Skeleton } from '@garden/ui/components/ui/skeleton'
import { TeamDetailCard } from '@/features/teams/components/team-detail'
import {
  TEAM_GRID_CLASS,
  TeamManagementPanel,
} from '@/features/teams/components/team-management-panel'
import { teamDetailOptions, teamListOptions } from '@/features/teams/queries'
import { memberListOptions } from '@/lib/workspace/queries'
import { MembersTab } from './members-tab'

const PILL_CLASS =
  'inline-flex h-7 items-center rounded-full border border-border-default bg-background-main-default px-4 text-sm text-text-default transition-colors hover:bg-background-main-default-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-[current=page]:border-border-brand-default aria-[current=page]:bg-background-brand-tertiary aria-[current=page]:text-text-brand-default'

/**
 * Members and Team sub-tabs. Team stays active on Team detail pages because
 * its link matches every path under `/teams`.
 */
function UserManagementPills() {
  return (
    <nav aria-label="User management views" className="flex gap-2">
      <Link to="/settings/user-management/members" className={PILL_CLASS}>
        Members
      </Link>
      <Link to="/settings/user-management/teams" className={PILL_CLASS}>
        Team
      </Link>
    </nav>
  )
}

/** Owners and admins hold `teamManage`; null while the role is loading. */
function useCanManageTeams() {
  const wsId = useWorkspaceId()
  const currentUserId = useAuthStore((s) => s.user?.id)
  const membersQuery = useQuery(memberListOptions(wsId))
  if (membersQuery.isPending) return null
  const role = membersQuery.data?.find((m) => m.user_id === currentUserId)?.role
  return role === 'owner' || role === 'admin'
}

/**
 * Team pages wait for the viewer's role, then send anyone without
 * `teamManage` to Members. A failed members query lands there too, where
 * MembersTab owns the retry.
 */
function TeamManagerOnly({
  loading,
  children,
}: {
  loading: ReactNode
  children: ReactNode
}) {
  const canManageTeams = useCanManageTeams()
  if (canManageTeams === null) return loading
  if (!canManageTeams) {
    return <Navigate to="/settings/user-management/members" replace />
  }
  return children
}

/** Settings › User Management › Members: everyone's member list. */
export function UserManagementMembers() {
  const canManageTeams = useCanManageTeams()
  return (
    <MembersTab toolbar={canManageTeams ? <UserManagementPills /> : null} />
  )
}

function TeamList() {
  const wsId = useWorkspaceId()
  const { data } = useSuspenseQuery(teamListOptions(wsId))
  return (
    <TeamManagementPanel
      teams={data.teams}
      teamLink="/settings/user-management/teams/$teamId"
      toolbar={<UserManagementPills />}
    />
  )
}

function TeamListSkeleton() {
  return (
    <div
      className="@container flex flex-col gap-8"
      aria-busy="true"
      aria-label="Loading teams"
    >
      <div className="flex items-center justify-between gap-4">
        <UserManagementPills />
        <Skeleton className="h-10 w-32" />
      </div>
      <div className={TEAM_GRID_CLASS}>
        <Skeleton className="h-[196px] rounded-xl" />
        <Skeleton className="h-[196px] rounded-xl" />
        <Skeleton className="h-[196px] rounded-xl" />
      </div>
    </div>
  )
}

/** Settings › User Management › Team: owner/admin Team management. */
export function UserManagementTeams() {
  return (
    <TeamManagerOnly loading={<TeamListSkeleton />}>
      <Suspense fallback={<TeamListSkeleton />}>
        <TeamList />
      </Suspense>
    </TeamManagerOnly>
  )
}

function TeamBreadcrumb({ teamId }: { teamId: string }) {
  const wsId = useWorkspaceId()
  const { data: team } = useSuspenseQuery(teamDetailOptions(wsId, teamId))
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-4 text-sm">
      <Link
        to="/settings/user-management/teams"
        className="text-text-secondary hover:underline"
      >
        Teams
      </Link>
      <span aria-hidden className="text-text-tertiary">
        /
      </span>
      <span aria-current="page" className="truncate text-text-default">
        {team.name}
      </span>
    </nav>
  )
}

function TeamDetailSkeleton() {
  return (
    <div
      className="flex flex-col gap-8"
      aria-busy="true"
      aria-label="Loading team"
    >
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-96 w-full rounded-xl" />
    </div>
  )
}

/**
 * Settings › User Management › Team detail: a Teams breadcrumb over the same
 * Team detail card as `/teams/$teamId`, showing its Members view only. "See
 * issues" opens the Team's Issues tab in the Teams area.
 */
export function UserManagementTeamDetail({ teamId }: { teamId: string }) {
  const navigate = useNavigate()
  return (
    <TeamManagerOnly loading={<TeamDetailSkeleton />}>
      <Suspense fallback={<TeamDetailSkeleton />}>
        <div className="flex flex-col gap-8">
          <TeamBreadcrumb teamId={teamId} />
          <TeamDetailCard
            teamId={teamId}
            tab="members"
            showTabs={false}
            onTabChange={(tab) =>
              void navigate({
                to: '/teams/$teamId',
                params: { teamId },
                search: { tab },
              })
            }
            onDeleted={() =>
              void navigate({ to: '/settings/user-management/teams' })
            }
            className="border lg:border-0"
          />
        </div>
      </Suspense>
    </TeamManagerOnly>
  )
}
