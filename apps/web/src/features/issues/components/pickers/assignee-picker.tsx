import { useMemo, useState } from 'react'
import { Lock, UserMinus } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import type {
  Agent,
  IssueAssigneeType,
  UpdateIssueRequest,
} from '@garden/core/types'
import { useAuthStore } from '@garden/app-state/auth'
import { useWorkspaceId } from '@garden/app-state/hooks'
import { useActorName } from '@/lib/workspace/hooks'
import {
  agentListOptions,
  assigneeFrequencyOptions,
  memberListOptions,
} from '@/lib/workspace/queries'
import { ActorAvatar } from '../../../common/actor-avatar'
import {
  PickerEmpty,
  PickerItem,
  PickerSection,
  PropertyPicker,
} from './property-picker'
import { usePickerOpen } from './picker-state'

export function canAssignAgent(
  agent: Agent,
  userId: string | undefined,
  memberRole: string | undefined,
): boolean {
  return (
    agent.visibility !== 'private' ||
    agent.owner_id === userId ||
    memberRole === 'owner' ||
    memberRole === 'admin'
  )
}

type AssigneeChoice = { type: IssueAssigneeType; id: string }

/** Member and agent picker ranked by recent assignment frequency. */
export function AssigneePicker({
  assigneeType,
  assigneeId,
  onUpdate,
  trigger,
  triggerRender,
  open: controlledOpen,
  onOpenChange,
  align,
}: {
  assigneeType: IssueAssigneeType | null
  assigneeId: string | null
  onUpdate: (updates: Partial<UpdateIssueRequest>) => void
  trigger?: React.ReactNode
  triggerRender?: React.ReactElement
  open?: boolean
  onOpenChange?: (open: boolean) => void
  align?: 'start' | 'center' | 'end'
}) {
  const [open, setOpen] = usePickerOpen(controlledOpen, onOpenChange)
  const [query, setQuery] = useState('')
  const workspaceId = useWorkspaceId()
  const user = useAuthStore((state) => state.user)
  const { getActorName } = useActorName()
  const { data: members = [] } = useQuery(memberListOptions(workspaceId))
  const { data: agents = [] } = useQuery(agentListOptions(workspaceId))
  const { data: frequencies = [] } = useQuery(
    assigneeFrequencyOptions(workspaceId),
  )

  const rank = useMemo(
    () =>
      new Map(
        frequencies.map((entry) => [
          `${entry.assignee_type}:${entry.assignee_id}`,
          entry.frequency,
        ]),
      ),
    [frequencies],
  )
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const memberRole = members.find((member) => member.user_id === user?.id)?.role
  const visibleMembers = [...members]
    .filter((member) =>
      member.name.toLocaleLowerCase().includes(normalizedQuery),
    )
    .sort(
      (left, right) =>
        (rank.get(`member:${right.user_id}`) ?? 0) -
        (rank.get(`member:${left.user_id}`) ?? 0),
    )
  const visibleAgents = [...agents]
    .filter(
      (agent) =>
        !agent.archived_at &&
        agent.name.toLocaleLowerCase().includes(normalizedQuery),
    )
    .sort(
      (left, right) =>
        (rank.get(`agent:${right.id}`) ?? 0) -
        (rank.get(`agent:${left.id}`) ?? 0),
    )

  const selected = (choice: AssigneeChoice) =>
    assigneeType === choice.type && assigneeId === choice.id
  const choose = (choice: AssigneeChoice | null) => {
    onUpdate({
      assignee_type: choice?.type ?? null,
      assignee_id: choice?.id ?? null,
    })
    setOpen(false)
  }

  return (
    <PropertyPicker
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) setQuery('')
      }}
      width="w-52"
      align={align}
      searchable
      searchPlaceholder="Assign to…"
      onSearchChange={setQuery}
      triggerRender={triggerRender}
      trigger={
        trigger ??
        (assigneeType && assigneeId ? (
          <>
            <ActorAvatar
              actorType={assigneeType}
              actorId={assigneeId}
              size={18}
            />
            <span className="truncate">
              {getActorName(assigneeType, assigneeId)}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">Unassigned</span>
        ))
      }
    >
      {!normalizedQuery ? (
        <PickerItem selected={!assigneeId} onClick={() => choose(null)}>
          <UserMinus className="size-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">Unassigned</span>
        </PickerItem>
      ) : null}

      {visibleMembers.length ? (
        <PickerSection label="Members">
          {visibleMembers.map((member) => {
            const choice = { type: 'member' as const, id: member.user_id }
            return (
              <PickerItem
                key={member.user_id}
                selected={selected(choice)}
                onClick={() => choose(choice)}
              >
                <ActorAvatar
                  actorType="member"
                  actorId={member.user_id}
                  size={18}
                />
                <span>{member.name}</span>
              </PickerItem>
            )
          })}
        </PickerSection>
      ) : null}

      {visibleAgents.length ? (
        <PickerSection label="Agents">
          {visibleAgents.map((agent) => {
            const choice = { type: 'agent' as const, id: agent.id }
            const allowed = canAssignAgent(agent, user?.id, memberRole)
            return (
              <PickerItem
                key={agent.id}
                selected={selected(choice)}
                disabled={!allowed}
                onClick={() => choose(choice)}
              >
                <ActorAvatar actorType="agent" actorId={agent.id} size={18} />
                <span className={allowed ? undefined : 'text-muted-foreground'}>
                  {agent.name}
                </span>
                {agent.visibility === 'private' ? (
                  <Lock className="ml-auto size-3 text-muted-foreground" />
                ) : null}
              </PickerItem>
            )
          })}
        </PickerSection>
      ) : null}

      {!visibleMembers.length && !visibleAgents.length && query ? (
        <PickerEmpty />
      ) : null}
    </PropertyPicker>
  )
}
