import type { TeamMember } from '@garden/core/types'
import { Trash2 } from 'lucide-react'
import { Badge } from '@garden/ui/components/ui/badge'
import { Button } from '@garden/ui/components/ui/button'

export type MemberRoleLabel = 'Team Owner' | 'Admin' | 'Member' | 'Agent'

/** Display role for a Team member: agents, owner, workspace admins, members. */
export function memberRoleLabel(
  member: TeamMember,
  ownerUserId: string,
): MemberRoleLabel {
  if (member.member_type === 'agent') return 'Agent'
  if (member.user_id === ownerUserId) return 'Team Owner'
  return member.workspace_role === 'admin' ? 'Admin' : 'Member'
}

/** Header cells stick to the top of the scrolling table frame. */
const HEAD_CELL =
  'sticky top-0 z-10 border-border-default bg-background-main-secondary py-4 text-center font-semibold text-text-default'

/**
 * The Teams design's member table (User / Role / Assigned Tasks / Action).
 * The owner's role renders as the blue "Team Owner" badge; everyone else gets
 * the gray badge. Managers get a ghost trash action on every row except the
 * owner's. The design's per-member View all is left out because no member
 * activity history exists yet. The frame caps at 32rem and scrolls with a
 * sticky header; below a 40rem minimum it also scrolls sideways instead of
 * crushing the columns.
 */
export function TeamMembersTable({
  members,
  ownerUserId,
  canManage,
  search,
  onRemove,
}: {
  members: TeamMember[]
  ownerUserId: string
  canManage: boolean
  search: string
  onRemove: (member: TeamMember) => void
}) {
  return (
    <div
      id="team-members-table"
      className="max-h-[32rem] overflow-auto rounded-2xl border border-border-default"
    >
      <table className="w-full min-w-[40rem] table-fixed text-sm">
        <thead>
          <tr>
            <th className={`${HEAD_CELL} px-6`}>User</th>
            <th className={`${HEAD_CELL} border-l px-6`}>Role</th>
            <th className={`${HEAD_CELL} border-l px-6`}>Assigned Tasks</th>
            <th className={`${HEAD_CELL} w-[10rem] border-l px-4`}>Action</th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => {
            const role = memberRoleLabel(member, ownerUserId)
            const removable = canManage && member.user_id !== ownerUserId
            return (
              <tr
                key={member.id}
                className="border-t border-border-default bg-background-main-default"
              >
                <td className="px-6 py-4">
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-text-default">
                      {member.name}
                    </span>
                    <span className="truncate text-text-secondary">
                      {member.email ?? 'Agent'}
                    </span>
                  </span>
                </td>
                <td className="border-l border-border-default px-6 py-4 text-center">
                  <Badge
                    className={
                      role === 'Team Owner'
                        ? 'bg-badge-blue-background text-badge-blue-text'
                        : 'bg-badge-gray-background text-badge-gray-text'
                    }
                  >
                    {role}
                  </Badge>
                </td>
                <td className="border-l border-border-default px-6 py-4 text-center text-text-secondary">
                  {member.assigned_issue_count > 0
                    ? member.assigned_issue_count
                    : 'None'}
                </td>
                <td className="border-l border-border-default px-4 py-4">
                  <span className="flex items-center justify-center gap-2 whitespace-nowrap">
                    {canManage ? (
                      removable ? (
                        <Button
                          aria-label={`Remove ${member.name}`}
                          onClick={() => onRemove(member)}
                          size="icon-sm"
                          variant="ghost"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      ) : (
                        <span aria-hidden className="size-7" />
                      )
                    ) : null}
                  </span>
                </td>
              </tr>
            )
          })}
          {members.length === 0 ? (
            <tr className="border-t border-border-default bg-background-main-default">
              <td
                colSpan={4}
                className="px-6 py-8 text-center text-text-secondary"
              >
                {search ? `No members match “${search}”.` : 'No members yet.'}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  )
}
