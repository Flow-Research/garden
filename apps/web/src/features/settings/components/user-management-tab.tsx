import { Suspense } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useWorkspaceId } from '@garden/app-state/hooks'
import { useAuthStore } from '@garden/app-state/auth'
import { Skeleton } from '@garden/ui/components/ui/skeleton'
import { TeamManagementPanel } from '@/features/teams/components/team-management-panel'
import { teamListOptions } from '@/features/teams/queries'
import { memberListOptions } from '@/lib/workspace/queries'
import { MembersTab } from './members-tab'
import { SettingsPanel } from './settings-page-shell'

export type UserManagementView = 'members' | 'team'

const PILL_CLASS =
  'inline-flex h-7 items-center rounded-full border border-border-default bg-background-main-default px-4 text-sm text-text-default transition-colors hover:bg-background-main-default-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-[current=page]:border-border-brand-default aria-[current=page]:bg-background-brand-tertiary aria-[current=page]:text-text-brand-default'

/**
 * Members and Team sub-tabs. Each pill is a link so the view survives reload
 * and history; `exact` makes the search params part of the active match.
 */
function UserManagementPills() {
  return (
    <nav aria-label="User management views" className="flex gap-2">
      <Link
        to="/settings/user-management"
        search={{}}
        activeOptions={{ exact: true }}
        className={PILL_CLASS}
      >
        Members
      </Link>
      <Link
        to="/settings/user-management"
        search={{ view: 'team' }}
        activeOptions={{ exact: true }}
        className={PILL_CLASS}
      >
        Team
      </Link>
    </nav>
  )
}

function TeamView() {
  const wsId = useWorkspaceId()
  const { data } = useSuspenseQuery(teamListOptions(wsId))
  return (
    <TeamManagementPanel teams={data.teams} toolbar={<UserManagementPills />} />
  )
}

function TeamViewSkeleton() {
  return (
    <div
      className="flex flex-col gap-8"
      aria-busy="true"
      aria-label="Loading teams"
    >
      <div className="flex items-center justify-between gap-4">
        <UserManagementPills />
        <Skeleton className="h-10 w-32" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Skeleton className="h-[196px] rounded-xl" />
        <Skeleton className="h-[196px] rounded-xl" />
        <Skeleton className="h-[196px] rounded-xl" />
      </div>
    </div>
  )
}

/**
 * Settings › User Management. Everyone sees workspace members and
 * invitations. Owners and admins also get the Team sub-tab, because creating,
 * deleting and staffing Teams requires the `teamManage` permission.
 */
export function UserManagementTab({ view }: { view: UserManagementView }) {
  const wsId = useWorkspaceId()
  const currentUserId = useAuthStore((s) => s.user?.id)
  const membersQuery = useQuery(memberListOptions(wsId))
  const role = membersQuery.data?.find((m) => m.user_id === currentUserId)?.role
  const canManageTeams = role === 'owner' || role === 'admin'

  // The role decides whether ?view=team is allowed, so hold the Team skeleton
  // until it loads instead of flashing the member list on reload. A failed
  // members query falls through to MembersTab, which owns the retry.
  if (view === 'team' && membersQuery.isPending) return <TeamViewSkeleton />

  if (canManageTeams && view === 'team') {
    return (
      <Suspense fallback={<TeamViewSkeleton />}>
        <TeamView />
      </Suspense>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      {canManageTeams ? <UserManagementPills /> : null}
      <SettingsPanel>
        <MembersTab />
      </SettingsPanel>
    </div>
  )
}
