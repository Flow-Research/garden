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
import { teamMemberListOptions } from '@/features/teams/queries'
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

/** Human option, sourced from either the workspace or the Team member list. */
interface AssigneeMemberOption {
  user_id: string
  name: string
}

/** Agent option with its assignment affordance pre-resolved. */
interface AssigneeAgentOption {
  id: string
  name: string
  allowed: boolean
  isPrivate: boolean
}

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
  teamId = null,
}: {
  assigneeType: IssueAssigneeType | null
  assigneeId: string | null
  onUpdate: (updates: Partial<UpdateIssueRequest>) => void
  trigger?: React.ReactNode
  triggerRender?: React.ReactElement
  open?: boolean
  onOpenChange?: (open: boolean) => void
  align?: 'start' | 'center' | 'end'
  /**
   * Team scope for the assignee list. When set, only that Team's members are
   * offered (the API rejects non-members) and "Unassigned" is hidden (Team
   * issues must always carry a Team member assignee).
   */
  teamId?: string | null
}) {
  const [open, setOpen] = usePickerOpen(controlledOpen, onOpenChange)
  const [query, setQuery] = useState('')
  const workspaceId = useWorkspaceId()
  const user = useAuthStore((state) => state.user)
  const { getActorName } = useActorName()
  const teamScoped = Boolean(teamId)

  // Workspace-wide sources stay disabled for Team-scoped pickers: the Team
  // member list is the only valid assignee set there.
  const { data: workspaceMembers = [] } = useQuery({
    ...memberListOptions(workspaceId),
    enabled: !teamScoped,
  })
  const { data: workspaceAgents = [] } = useQuery({
    ...agentListOptions(workspaceId),
    enabled: !teamScoped,
  })
  const { data: teamMembers = [] } = useQuery({
    ...teamMemberListOptions(workspaceId, teamId ?? ''),
    enabled: teamScoped,
  })
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

  // The current user's workspace role gates private-agent assignment in the
  // workspace list; in Team scope, membership itself is the boundary.
  const memberRole = teamScoped
    ? teamMembers.find((member) => member.user_id === user?.id)?.workspace_role
    : workspaceMembers.find((member) => member.user_id === user?.id)?.role

  const memberOptions = useMemo<AssigneeMemberOption[]>(
    () =>
      teamScoped
        ? teamMembers
            .filter((member) => member.member_type === 'user' && member.user_id)
            .map((member) => ({
              user_id: member.user_id as string,
              name: member.name,
            }))
        : workspaceMembers.map((member) => ({
            user_id: member.user_id,
            name: member.name,
          })),
    [teamMembers, teamScoped, workspaceMembers],
  )

  const agentOptions = useMemo<AssigneeAgentOption[]>(
    () =>
      teamScoped
        ? teamMembers
            .filter(
              (member) =>
                member.member_type === 'agent' &&
                member.agent_id &&
                member.agent_status === 'active',
            )
            .map((member) => ({
              id: member.agent_id as string,
              name: member.name,
              allowed: true,
              isPrivate: false,
            }))
        : workspaceAgents
            .filter((agent) => !agent.archived_at)
            .map((agent) => ({
              id: agent.id,
              name: agent.name,
              allowed: canAssignAgent(agent, user?.id, memberRole ?? undefined),
              isPrivate: agent.visibility === 'private',
            })),
    [memberRole, teamMembers, teamScoped, user?.id, workspaceAgents],
  )

  const visibleMembers = [...memberOptions]
    .filter((member) =>
      member.name.toLocaleLowerCase().includes(normalizedQuery),
    )
    .sort(
      (left, right) =>
        (rank.get(`member:${right.user_id}`) ?? 0) -
        (rank.get(`member:${left.user_id}`) ?? 0),
    )
  const visibleAgents = [...agentOptions]
    .filter((agent) => agent.name.toLocaleLowerCase().includes(normalizedQuery))
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
          <span className="text-muted-foreground">
            {teamScoped ? 'Select assignee' : 'Unassigned'}
          </span>
        ))
      }
    >
      {!normalizedQuery && !teamScoped ? (
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
            return (
              <PickerItem
                key={agent.id}
                selected={selected(choice)}
                disabled={!agent.allowed}
                onClick={() => choose(choice)}
              >
                <ActorAvatar actorType="agent" actorId={agent.id} size={18} />
                <span
                  className={agent.allowed ? undefined : 'text-muted-foreground'}
                >
                  {agent.name}
                </span>
                {agent.isPrivate ? (
                  <Lock className="ml-auto size-3 text-muted-foreground" />
                ) : null}
              </PickerItem>
            )
          })}
        </PickerSection>
      ) : null}

      {!visibleMembers.length &&
      !visibleAgents.length &&
      (query || teamScoped) ? (
        <PickerEmpty />
      ) : null}
    </PropertyPicker>
  )
}
