import type { Team, TeamMember } from '@garden/core/types'
import { TeamSummaryCard, TeamSummaryMenu } from './team-summary-card'
import { TeamMembersTable, memberRoleLabel } from './team-members-table'

function scrollToMembersTable() {
  document
    .getElementById('team-members-table')
    ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

/**
 * Members tab of the Team detail page, matched to the Penpot design: three
 * bordered summary cards (Total members / Total Roles / Total Activity) with
 * ⋯ menus, then the member table. Totals are Team-wide; the table below shows
 * the searched/role-filtered member set.
 */
export function TeamMembersPanel({
  team,
  members,
  visibleMembers,
  canManage,
  search,
  onRemove,
}: {
  team: Team
  members: TeamMember[]
  visibleMembers: TeamMember[]
  canManage: boolean
  search: string
  onRemove: (member: TeamMember) => void
}) {
  const roleCount = new Set(
    members.map((member) => memberRoleLabel(member, team.owner_user_id)),
  ).size

  return (
    <div className="flex flex-col gap-8">
      <div className="flex gap-3">
        <TeamSummaryCard
          label="Total members"
          value={team.member_count}
          action={
            <TeamSummaryMenu
              items={[{ label: 'See members', onSelect: scrollToMembersTable }]}
            />
          }
        />
        <TeamSummaryCard
          label="Total Roles"
          value={roleCount}
          action={
            <TeamSummaryMenu
              items={[{ label: 'See members', onSelect: scrollToMembersTable }]}
            />
          }
        />
        <TeamSummaryCard
          label="Total Activity"
          value={team.activity_count}
          action={
            <TeamSummaryMenu
              items={[{ label: 'See activity', disabled: true }]}
            />
          }
        />
      </div>

      <TeamMembersTable
        canManage={canManage}
        members={visibleMembers}
        onRemove={onRemove}
        ownerUserId={team.owner_user_id}
        search={search}
      />
    </div>
  )
}
