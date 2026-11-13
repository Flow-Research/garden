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

/**
 * The Teams design's member table (User / Role / Assigned Tasks / Activity)
 * from designs 30 and 33. The owner's role renders as the blue "Team Owner"
 * badge; everyone else gets the gray badge. Managers get the design's
 * per-row Agent settings button, which opens the Team agent policy sheet.
 * Remove is absent from the design but must stay reachable, so removable rows
 * keep a ghost trash action after View all. The Activity column gets a fixed
 * width so all three actions fit inside the cell. View all stays disabled
 * (no activity history surface exists yet) and says so via its wrapper title.
 */
export function TeamMembersTable({
  members,
  ownerUserId,
  canManage,
  search,
  onRemove,
  onAgentSettings,
}: {
  members: TeamMember[]
  ownerUserId: string
  canManage: boolean
  search: string
  onRemove: (member: TeamMember) => void
  onAgentSettings: () => void
}) {
  return (
    <div
      id="team-members-table"
      className="overflow-hidden rounded-2xl border border-border-default"
    >
      <table className="w-full table-fixed text-sm">
        <thead>
          <tr className="bg-background-main-secondary">
            <th className="px-6 py-4 text-center font-semibold text-text-default">
              User
            </th>
            <th className="px-6 py-4 text-center font-semibold text-text-default">
              Role
            </th>
            <th className="px-6 py-4 text-center font-semibold text-text-default">
              Assigned Tasks
            </th>
            <th className="w-[18rem] px-4 py-4 text-center font-semibold text-text-default">
              Activity
            </th>
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
                      <Button
                        className="h-8 rounded-md px-3 shadow-1"
                        onClick={onAgentSettings}
                        variant="outline"
                      >
                        Agent settings
                      </Button>
                    ) : null}
                    <span title="Member activity history is not available yet">
                      <Button
                        className="h-8 rounded-md px-3 shadow-1"
                        disabled
                        variant="outline"
                      >
                        View all
                      </Button>
                    </span>
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
