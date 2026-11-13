import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useWorkspaceId } from '@garden/app-state/hooks'
import type {
  AddTeamMemberRequest,
  TeamMember,
  TeamSummary,
} from '@garden/core/types'
import { Button } from '@garden/ui/components/ui/button'
import { ConfirmDialog } from '@garden/ui/components/common/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@garden/ui/components/ui/dialog'
import { Input } from '@garden/ui/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@garden/ui/components/ui/popover'
import { Search } from 'lucide-react'
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
    existing
      .filter((member) => member.agent_id)
      .map((member) => member.agent_id),
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
    <Dialog
      open
      onOpenChange={(open) => !open && !addMember.isPending && onClose()}
    >
      <DialogContent size="md" className="gap-0 overflow-hidden p-0">
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
          <Button
            variant="outline"
            onClick={onClose}
            disabled={addMember.isPending}
          >
            Cancel
          </Button>
          <Button
            disabled={!selectedKey || addMember.isPending}
            onClick={handleAdd}
          >
            {addMember.isPending ? 'Adding…' : 'Add member'}
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
    <Dialog
      open
      onOpenChange={(open) => !open && !updateTeam.isPending && onClose()}
    >
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Team details</DialogTitle>
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
          <Button
            variant="outline"
            onClick={onClose}
            disabled={updateTeam.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!name.trim() || updateTeam.isPending}
          >
            {updateTeam.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Setup Owner popover from designs 31–32. It replaces the old modal transfer
 * dialog: the picker now anchors under the Setup Owner button, filters human
 * members by name or email, lists them as name/email rows with a trailing
 * radio, and commits with a full-width Make Team Owner button that stays
 * disabled until a non-owner is chosen.
 */
export function TransferOwnerPopover({
  team,
  members,
}: {
  team: TeamSummary
  members: TeamMember[]
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const transfer = useTransferTeamOwner()

  const needle = query.trim().toLowerCase()
  const candidates = members.filter(
    (member) =>
      member.member_type === 'user' &&
      member.user_id &&
      `${member.name} ${member.email ?? ''}`.toLowerCase().includes(needle),
  )

  const handleOpenChange = (next: boolean) => {
    if (transfer.isPending) return
    setOpen(next)
    if (!next) {
      setQuery('')
      setSelectedId(null)
    }
  }

  const handleTransfer = () => {
    if (!selectedId) return
    transfer.mutateAsync({ teamId: team.id, owner_user_id: selectedId }).then(
      () => {
        toast.success('Team owner updated')
        handleOpenChange(false)
      },
      (error: unknown) =>
        toast.error(
          error instanceof Error ? error.message : 'Failed to update owner',
        ),
    )
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button className="h-10 rounded-md px-3 shadow-1" variant="outline" />
        }
      >
        Setup Owner
      </PopoverTrigger>
      <PopoverContent
        align="center"
        className="flex w-[23rem] flex-col gap-4 rounded-xl p-4"
        sideOffset={12}
      >
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-icon-secondary" />
          <Input
            aria-label="Search for team member"
            className="h-10 rounded-md border-0 bg-background-main-secondary pl-10 shadow-none placeholder:text-text-secondary"
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search for team member"
            value={query}
          />
        </div>
        <span className="text-xs text-text-secondary uppercase">
          Team members
        </span>
        <ul className="-mt-1 flex max-h-60 flex-col gap-3 overflow-y-auto">
          {candidates.map((member) => {
            const isOwner = member.user_id === team.owner_user_id
            return (
              <li key={member.id}>
                <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{member.name}</span>
                    <span className="truncate text-text-secondary">
                      {member.email}
                    </span>
                  </span>
                  <input
                    aria-label={member.name}
                    checked={selectedId === member.user_id}
                    className="size-4 accent-primary"
                    disabled={isOwner}
                    name="team-owner-candidate"
                    onChange={() => setSelectedId(member.user_id)}
                    type="radio"
                  />
                </label>
              </li>
            )
          })}
          {candidates.length === 0 ? (
            <li className="py-2 text-center text-sm text-text-secondary">
              No matching members
            </li>
          ) : null}
        </ul>
        <Button
          className="h-10 w-full"
          disabled={!selectedId || transfer.isPending}
          onClick={handleTransfer}
        >
          {transfer.isPending ? 'Saving…' : 'Make Team Owner'}
        </Button>
      </PopoverContent>
    </Popover>
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

  /** Keeps the delete confirmation open when the API rejects the deletion. */
  const handleDelete = () =>
    deleteTeam.mutateAsync(team.id).then(
      () => {
        toast.success(`${team.name} deleted`)
        onDeleted()
      },
      (error: unknown) => {
        // A Team with linked issues cannot be deleted; the API returns a stable
        // TEAM_HAS_ISSUES code and the message is safe to surface.
        toast.error(
          error instanceof Error ? error.message : 'Failed to delete Team',
        )
        throw error
      },
    )

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Delete ${team.name}?`}
      description="This removes the Team and its membership list. Issues linked to the Team must be moved or reassigned first; issue history is never deleted with a Team."
      confirmLabel="Delete Team"
      pendingLabel="Deleting…"
      tone="destructive"
      onConfirm={handleDelete}
    />
  )
}
