import type { Team, TeamMember } from '@garden/core/types'
import { TeamSummaryCard, TeamSummaryMenu } from './team-summary-card'
import { TeamMembersTable } from './team-members-table'

/**
 * Members tab of the Team detail page, matched to design 30: three bordered
 * summary cards (Total members / Total Assigned Tasks / Total Activity), each
 * with a ⋮ menu, then the member table. Totals are Team-wide; the table
 * shows the searched and role-filtered member set.
 */
export function TeamMembersPanel({
  team,
  members,
  visibleMembers,
  canManage,
  search,
  onRemove,
  onAddMember,
  onAgentSettings,
  onSeeIssues,
}: {
  team: Team
  members: TeamMember[]
  visibleMembers: TeamMember[]
  canManage: boolean
  search: string
  onRemove: (member: TeamMember) => void
  onAddMember: () => void
  onAgentSettings: () => void
  onSeeIssues: () => void
}) {
  const assignedTasks = members.reduce(
    (sum, member) => sum + member.assigned_issue_count,
    0,
  )

  return (
    <div className="flex flex-col gap-8">
      <div className="flex gap-3">
        <TeamSummaryCard
          label="Total members"
          value={team.member_count}
          action={
            <TeamSummaryMenu
              items={[
                {
                  label: 'Add a team member',
                  disabled: !canManage,
                  onSelect: onAddMember,
                },
              ]}
            />
          }
        />
        <TeamSummaryCard
          label="Total Assigned Tasks"
          value={assignedTasks}
          action={
            <TeamSummaryMenu
              items={[{ label: 'See issues', onSelect: onSeeIssues }]}
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
        onAgentSettings={onAgentSettings}
        onRemove={onRemove}
        ownerUserId={team.owner_user_id}
        search={search}
      />
    </div>
  )
}
