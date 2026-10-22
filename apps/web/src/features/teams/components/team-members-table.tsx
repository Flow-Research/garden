import type { TeamMember } from '@garden/core/types'
import { Trash2 } from 'lucide-react'
import { Badge } from '@garden/ui/components/ui/badge'
import { Button } from '@garden/ui/components/ui/button'

/** Display role for a Team member: agents, owner, workspace admins, members. */
export function memberRoleLabel(member: TeamMember, ownerUserId: string) {
  if (member.member_type === 'agent') return 'Agent'
  if (member.user_id === ownerUserId) return 'Owner'
  return member.workspace_role === 'admin' ? 'Admin' : 'Member'
}

/**
 * The Teams design's member table (User / Role / Assigned Tasks / Activity),
 * mirroring the shared FileListTable pattern from the Files display: a
 * rounded-2xl bordered container, an unbroken gray header band, and vertical
 * rules between body cells. The first column left-aligns identity; the rest
 * center. Remove is P0 but absent from the design, so it renders as a visible
 * ghost trash action on every removable row (users and agents, never the
 * owner); rows without it keep a same-size spacer so every View all stays
 * aligned in the column.
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
            <th className="px-6 py-4 text-center font-semibold text-text-default">
              Activity
            </th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => {
            const removable = canManage && member.user_id !== ownerUserId
            return (
              <tr
                key={member.id}
                className="border-t border-border-default bg-background-main-default"
              >
                <td className="px-6 py-5">
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-text-default">
                      {member.name}
                    </span>
                    <span className="truncate text-text-secondary">
                      {member.email ?? 'Agent'}
                    </span>
                  </span>
                </td>
                <td className="border-l border-border-default px-6 py-5 text-center">
                  <Badge className="bg-badge-gray-background text-badge-gray-text">
                    {memberRoleLabel(member, ownerUserId)}
                  </Badge>
                </td>
                <td className="border-l border-border-default px-6 py-5 text-center text-text-secondary">
                  {member.assigned_issue_count > 0
                    ? member.assigned_issue_count
                    : 'None'}
                </td>
                <td className="border-l border-border-default px-6 py-5">
                  <span className="flex items-center justify-center gap-2">
                    <Button
                      className="h-8 rounded-md px-3 shadow-1"
                      disabled
                      variant="outline"
                    >
                      View all
                    </Button>
                    {removable ? (
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
                    )}
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
                {search
                  ? `No members match “${search}”.`
                  : 'No members yet.'}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  )
}
