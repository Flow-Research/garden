import {
  ArrowDown,
  ArrowUp,
  Calendar,
  Link2,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Trash2,
  UserMinus,
} from 'lucide-react'
import type { Issue, UpdateIssueRequest } from '@garden/core/types'
import {
  ALL_STATUSES,
  PRIORITY_CONFIG,
  PRIORITY_ORDER,
  STATUS_CONFIG,
} from '@garden/core/issues/config'
import { Button } from '@garden/ui/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@garden/ui/components/ui/dropdown-menu'
import { ActorAvatar } from '../../common/actor-avatar'
import type { useIssueDetailData } from '../hooks/use-issue-detail-data'
import { canAssignAgent } from './pickers'
import { PriorityIcon } from './priority-icon'
import { StatusIcon } from './status-icon'

type IssueDetailData = ReturnType<typeof useIssueDetailData>

/** The issue header's "…" menu: quick property edits and issue actions. */
export function IssueActionsMenu({
  issue,
  members,
  agents,
  currentUserId,
  currentMemberRole,
  onUpdate,
  onOpenChat,
  openChatPending,
  onCreateSubIssue,
  onSetParent,
  onAddSubIssue,
  onCopyLink,
  onDelete,
}: {
  issue: Issue
  members: IssueDetailData['members']
  agents: IssueDetailData['agents']
  currentUserId: string | undefined
  currentMemberRole: IssueDetailData['currentMemberRole']
  onUpdate: (updates: Partial<UpdateIssueRequest>) => void
  onOpenChat: () => void
  openChatPending: boolean
  onCreateSubIssue: () => void
  onSetParent: () => void
  onAddSubIssue: () => void
  onCopyLink: () => void
  onDelete: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label="Issue actions"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
          >
            <MoreHorizontal />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-auto">
        {/* Status */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <StatusIcon status={issue.status} className="h-3.5 w-3.5" />
            Status
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {ALL_STATUSES.map((s) => (
              <DropdownMenuItem key={s} onClick={() => onUpdate({ status: s })}>
                <StatusIcon status={s} className="h-3.5 w-3.5" />
                {STATUS_CONFIG[s].label}
                {issue.status === s && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    ✓
                  </span>
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {/* Priority */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <PriorityIcon priority={issue.priority} />
            Priority
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {PRIORITY_ORDER.map((p) => (
              <DropdownMenuItem
                key={p}
                onClick={() => onUpdate({ priority: p })}
              >
                <span
                  className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${PRIORITY_CONFIG[p].badgeBg} ${PRIORITY_CONFIG[p].badgeText}`}
                >
                  <PriorityIcon priority={p} className="h-3 w-3" inheritColor />
                  {PRIORITY_CONFIG[p].label}
                </span>
                {issue.priority === p && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    ✓
                  </span>
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {/* Assignee */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <UserMinus className="h-3.5 w-3.5" />
            Assignee
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem
              onClick={() =>
                onUpdate({
                  assignee_type: null,
                  assignee_id: null,
                })
              }
            >
              <UserMinus className="h-3.5 w-3.5 text-muted-foreground" />
              Unassigned
              {!issue.assignee_type && (
                <span className="ml-auto text-xs text-muted-foreground">✓</span>
              )}
            </DropdownMenuItem>
            {members.map((m) => (
              <DropdownMenuItem
                key={m.user_id}
                onClick={() =>
                  onUpdate({
                    assignee_type: 'member',
                    assignee_id: m.user_id,
                  })
                }
              >
                <ActorAvatar actorType="member" actorId={m.user_id} size={16} />
                {m.name}
                {issue.assignee_type === 'member' &&
                  issue.assignee_id === m.user_id && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      ✓
                    </span>
                  )}
              </DropdownMenuItem>
            ))}
            {agents
              .filter(
                (a) =>
                  !a.archived_at &&
                  canAssignAgent(a, currentUserId, currentMemberRole),
              )
              .map((a) => (
                <DropdownMenuItem
                  key={a.id}
                  onClick={() =>
                    onUpdate({
                      assignee_type: 'agent',
                      assignee_id: a.id,
                    })
                  }
                >
                  <ActorAvatar actorType="agent" actorId={a.id} size={16} />
                  {a.name}
                  {issue.assignee_type === 'agent' &&
                    issue.assignee_id === a.id && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        ✓
                      </span>
                    )}
                </DropdownMenuItem>
              ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {/* Due date */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Calendar className="h-3.5 w-3.5" />
            Due date
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem
              onClick={() =>
                onUpdate({
                  due_date: new Date().toISOString(),
                })
              }
            >
              Today
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                const d = new Date()
                d.setDate(d.getDate() + 1)
                onUpdate({ due_date: d.toISOString() })
              }}
            >
              Tomorrow
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                const d = new Date()
                d.setDate(d.getDate() + 7)
                onUpdate({ due_date: d.toISOString() })
              }}
            >
              Next week
            </DropdownMenuItem>
            {issue.due_date && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onUpdate({ due_date: null })}>
                  Clear date
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />

        {/* Open chat — switches the user from background-watching
            to an active conversation with this issue's assigned
            agent. Only available when the assignee is an agent. */}
        {issue.assignee_type === 'agent' && issue.assignee_id ? (
          <DropdownMenuItem onClick={onOpenChat} disabled={openChatPending}>
            <MessageSquare className="h-3.5 w-3.5" />
            {openChatPending ? 'Opening in chat…' : 'Open in chat'}
          </DropdownMenuItem>
        ) : null}

        {/* Create sub-issue */}
        <DropdownMenuItem onClick={onCreateSubIssue}>
          <Plus className="h-3.5 w-3.5" />
          Create sub-issue
        </DropdownMenuItem>

        {/* Add as sub-issue of another issue */}
        <DropdownMenuItem onClick={onSetParent}>
          <ArrowUp className="h-3.5 w-3.5" />
          Set parent issue...
        </DropdownMenuItem>

        {/* Add another issue as sub-issue */}
        <DropdownMenuItem onClick={onAddSubIssue}>
          <ArrowDown className="h-3.5 w-3.5" />
          Add sub-issue...
        </DropdownMenuItem>

        {/* Copy link */}
        <DropdownMenuItem onClick={onCopyLink}>
          <Link2 className="h-3.5 w-3.5" />
          Copy link
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* Delete */}
        <DropdownMenuItem variant="destructive" onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" />
          Delete issue
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
