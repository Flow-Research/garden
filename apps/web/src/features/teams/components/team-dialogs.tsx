import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useWorkspaceId } from '@garden/app-state/hooks'
import type {
  AddTeamMemberRequest,
  TeamMember,
  TeamSummary,
} from '@garden/core/types'
import { Button } from '@garden/ui/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@garden/ui/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@garden/ui/components/ui/dialog'
import { Input } from '@garden/ui/components/ui/input'
import { Textarea } from '@garden/ui/components/ui/textarea'
import { toast } from 'sonner'
import { ActorAvatar } from '@/features/common/actor-avatar'
import { agentListOptions, memberListOptions } from '@/lib/workspace/queries'
import {
  useAddTeamMember,
  useDeleteTeam,
  useTransferTeamOwner,
  useUpdateTeam,
} from '../mutations'

type Candidate = {
  key: string
  kind: 'user' | 'agent'
  id: string
  name: string
  email: string | null
}

export function AddTeamMemberDialog({
  teamId,
  existing,
  onClose,
}: {
  teamId: string
  existing: TeamMember[]
  onClose: () => void
}) {
  const wsId = useWorkspaceId()
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const membersQuery = useQuery(memberListOptions(wsId))
  const agentsQuery = useQuery(agentListOptions(wsId))
  const addMember = useAddTeamMember()

  const existingUserIds = new Set(
    existing.filter((member) => member.user_id).map((member) => member.user_id),
  )
  const existingAgentIds = new Set(
    existing.filter((member) => member.agent_id).map((member) => member.agent_id),
  )

  const candidates = useMemo<Candidate[]>(() => {
    const users: Candidate[] = (membersQuery.data ?? [])
      .filter((member) => !existingUserIds.has(member.user_id))
      .map((member) => ({
        key: `user:${member.user_id}`,
        kind: 'user',
        id: member.user_id,
        name: member.name,
        email: member.email,
      }))
    const agents: Candidate[] = (agentsQuery.data ?? [])
      .filter(
        (agent) =>
          agent.record_status === 'active' && !existingAgentIds.has(agent.id),
      )
      .map((agent) => ({
        key: `agent:${agent.id}`,
        kind: 'agent',
        id: agent.id,
        name: agent.name,
        email: null,
      }))
    return [...users, ...agents]
  }, [membersQuery.data, agentsQuery.data, existingAgentIds, existingUserIds])

  const handleAdd = async () => {
    const candidate = candidates.find((entry) => entry.key === selectedKey)
    if (!candidate) return
    const payload: AddTeamMemberRequest =
      candidate.kind === 'user'
        ? { member_type: 'user', user_id: candidate.id }
        : { member_type: 'agent', agent_id: candidate.id }
    try {
      await addMember.mutateAsync({ teamId, member: payload })
      toast.success(`${candidate.name} added to the Team`)
      onClose()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to add member',
      )
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="!w-[min(94vw,32rem)] gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>Add a team member</DialogTitle>
          <DialogDescription>
            Workspace members and active agents can join this Team.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[22rem] overflow-y-auto px-6 py-4">
          {candidates.length === 0 ? (
            <p className="py-10 text-center text-sm text-text-secondary">
              Everyone in this workspace is already on the Team.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {candidates.map((candidate) => (
                <li key={candidate.key}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-background-main-secondary">
                    <input
                      type="radio"
                      name="team-member-candidate"
                      checked={selectedKey === candidate.key}
                      onChange={() => setSelectedKey(candidate.key)}
                      className="size-3.5 accent-primary"
                    />
                    <ActorAvatar
                      actorType={candidate.kind}
                      actorId={candidate.id}
                      size={28}
                    />
                    <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
                      <span className="truncate text-sm">{candidate.name}</span>
                      <span className="truncate text-xs text-text-secondary">
                        {candidate.kind === 'agent' ? 'Agent' : candidate.email}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
        <DialogFooter className="border-t px-6 pt-4 pb-6">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!selectedKey} onClick={handleAdd}>
            Add member
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function EditTeamDialog({
  team,
  onClose,
}: {
  team: TeamSummary
  onClose: () => void
}) {
  const [name, setName] = useState(team.name)
  const [description, setDescription] = useState(team.description ?? '')
  const updateTeam = useUpdateTeam()

  const handleSave = async () => {
    if (!name.trim()) return
    try {
      await updateTeam.mutateAsync({
        id: team.id,
        name: name.trim(),
        description: description.trim() || null,
      })
      toast.success('Team updated')
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update')
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="!w-[min(94vw,32rem)]">
        <DialogHeader>
          <DialogTitle>Edit Team</DialogTitle>
          <DialogDescription>
            Update the Team name and description.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm">
            <span>Team name</span>
            <Input
              value={name}
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span>Description</span>
            <Textarea
              value={description}
              maxLength={5000}
              rows={4}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
        </div>
        <DialogFooter className="pb-6">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!name.trim()}>
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function TransferOwnerDialog({
  team,
  members,
  onClose,
}: {
  team: TeamSummary
  members: TeamMember[]
  onClose: () => void
}) {
  const humanMembers = members.filter(
    (member) => member.member_type === 'user' && member.user_id,
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const transfer = useTransferTeamOwner()

  const handleTransfer = async () => {
    if (!selectedId) return
    try {
      await transfer.mutateAsync({ teamId: team.id, owner_user_id: selectedId })
      toast.success('Team ownership transferred')
      onClose()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to transfer ownership',
      )
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="!w-[min(94vw,32rem)] gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>Transfer Team ownership</DialogTitle>
          <DialogDescription>
            The new owner must already be a Team member.
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-[22rem] divide-y overflow-y-auto">
          {humanMembers.map((member) => (
            <li key={member.id}>
              <label className="flex cursor-pointer items-center gap-3 px-6 py-2 hover:bg-background-main-secondary">
                <input
                  type="radio"
                  name="team-owner-candidate"
                  checked={selectedId === member.user_id}
                  disabled={member.user_id === team.owner_user_id}
                  onChange={() => setSelectedId(member.user_id)}
                  className="size-3.5 accent-primary"
                />
                <ActorAvatar
                  actorType="member"
                  actorId={member.user_id ?? ''}
                  size={28}
                />
                <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
                  <span className="truncate text-sm">{member.name}</span>
                  <span className="text-xs text-text-secondary">
                    {member.user_id === team.owner_user_id
                      ? 'Current owner'
                      : member.email}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <DialogFooter className="border-t px-6 pt-4 pb-6">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleTransfer} disabled={!selectedId}>
            Transfer ownership
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function DeleteTeamDialog({
  team,
  onClose,
  onDeleted,
}: {
  team: TeamSummary
  onClose: () => void
  onDeleted: () => void
}) {
  const deleteTeam = useDeleteTeam()

  const handleDelete = async () => {
    try {
      await deleteTeam.mutateAsync(team.id)
      toast.success(`${team.name} deleted`)
      onDeleted()
    } catch (error) {
      // A Team with linked issues cannot be deleted; the API returns a stable
      // TEAM_HAS_ISSUES code and the message is safe to surface.
      toast.error(
        error instanceof Error ? error.message : 'Failed to delete Team',
      )
      onClose()
    }
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {team.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the Team and its membership list. Issues linked to the
            Team must be moved or reassigned first; issue history is never
            deleted with a Team.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="pb-6">
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleDelete}>
            Delete Team
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
