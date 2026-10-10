import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useWorkspaceId } from '@garden/app-state/hooks'
import { useAuthStore } from '@garden/app-state/auth'
import type { AddTeamMemberRequest } from '@garden/core/types'
import { Button } from '@garden/ui/components/ui/button'
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
import { useCreateTeam } from '../mutations'
import { TeamCreatedToast } from './team-created-toast'
import { teamColor } from './team-tokens'

type PickerEntry =
  | { key: string; kind: 'user'; id: string; name: string; email: string }
  | { key: string; kind: 'agent'; id: string; name: string; email: null }

/**
 * Three-step Team creation: details, member picker, review. The creator is the
 * default owner and is always included as a member; the server enforces the
 * same invariants.
 */
export function CreateTeamDialog({ onClose }: { onClose: () => void }) {
  const wsId = useWorkspaceId()
  const currentUserId = useAuthStore((s) => s.user?.id ?? '')
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const createTeam = useCreateTeam()

  const membersQuery = useQuery({
    ...memberListOptions(wsId),
    enabled: step >= 2,
  })
  const agentsQuery = useQuery({
    ...agentListOptions(wsId),
    enabled: step >= 2,
  })

  const entries = useMemo<PickerEntry[]>(() => {
    const users: PickerEntry[] = (membersQuery.data ?? []).map((member) => ({
      key: `user:${member.user_id}`,
      kind: 'user',
      id: member.user_id,
      name: member.name,
      email: member.email,
    }))
    const agents: PickerEntry[] = (agentsQuery.data ?? [])
      .filter((agent) => agent.record_status === 'active')
      .map((agent) => ({
        key: `agent:${agent.id}`,
        kind: 'agent',
        id: agent.id,
        name: agent.name,
        email: null,
      }))
    return [...users, ...agents]
  }, [membersQuery.data, agentsQuery.data])

  const ownerKey = `user:${currentUserId}`
  const toggle = (key: string) => {
    if (key === ownerKey) return
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const selectedEntries = entries.filter((entry) => selected.has(entry.key))
  const ownerName =
    entries.find((entry) => entry.key === ownerKey)?.name ?? 'You'

  const handleCreate = async () => {
    if (!name.trim() || submitting) return
    setSubmitting(true)
    const initialMembers: AddTeamMemberRequest[] = selectedEntries.map(
      (entry) =>
        entry.kind === 'user'
          ? { member_type: 'user', user_id: entry.id }
          : { member_type: 'agent', agent_id: entry.id },
    )
    const result = await createTeam
      .mutateAsync({
        name: name.trim(),
        description: description.trim() || null,
        initial_members: initialMembers.length > 0 ? initialMembers : undefined,
      })
      .then((team) => ({ ok: true as const, team }))
      .catch((error: unknown) => ({ ok: false as const, error }))
    setSubmitting(false)
    if (!result.ok) {
      toast.error(
        result.error instanceof Error
          ? result.error.message
          : 'Failed to create Team',
      )
      return
    }
    toast.custom(
      () => <TeamCreatedToast title={`${result.team.name} team has been created`} />,
      { position: 'top-center' },
    )
    onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="!w-[min(94vw,36rem)] gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>Create New Team</DialogTitle>
          <DialogDescription>
            Step {step} of 3
            {step === 1
              ? ' — name and describe the Team'
              : step === 2
                ? ' — add members'
                : ' — review and create'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-[22rem] flex-col gap-4 px-6 py-5">
          {step === 1 ? (
            <>
              <label className="flex flex-col gap-1.5 text-sm">
                <span>
                  Team name <span className="text-text-danger-default">*</span>
                </span>
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={100}
                  placeholder="e.g. Engineering"
                  autoFocus
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span>Description</span>
                <Textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  maxLength={5000}
                  rows={4}
                  placeholder="What does this Team own?"
                />
              </label>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <div className="flex items-center justify-between text-xs text-text-secondary">
                <span>Team members</span>
                <span>
                  {selectedEntries.length + 1} selected
                </span>
              </div>
              <ul className="max-h-72 divide-y overflow-y-auto rounded-md border">
                {entries.map((entry) => {
                  const isOwner = entry.key === ownerKey
                  const checked = isOwner || selected.has(entry.key)
                  return (
                    <li key={entry.key}>
                      <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-background-main-secondary">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={isOwner}
                          onChange={() => toggle(entry.key)}
                          className="size-3.5 accent-primary"
                        />
                        <ActorAvatar
                          actorType={entry.kind}
                          actorId={entry.id}
                          size={28}
                        />
                        <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
                          <span className="truncate text-sm">{entry.name}</span>
                          <span className="truncate text-xs text-text-secondary">
                            {isOwner ? 'Owner' : entry.email}
                          </span>
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            </>
          ) : null}

          {step === 3 ? (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3 rounded-lg bg-background-main-secondary p-4">
                <span
                  className="size-2.5 rounded-full"
                  style={{ background: teamColor(name || 'team') }}
                />
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{name}</span>
                  <span className="text-xs text-text-secondary">
                    {description || 'No description'}
                  </span>
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div className="flex flex-col gap-0.5">
                  <dt className="text-xs text-text-secondary">Owner</dt>
                  <dd>{ownerName}</dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-xs text-text-secondary">Members</dt>
                  <dd>{selectedEntries.length + 1}</dd>
                </div>
              </dl>
              {selectedEntries.length > 0 ? (
                <ul className="flex flex-wrap gap-2">
                  {selectedEntries.map((entry) => (
                    <li
                      key={entry.key}
                      className="flex items-center gap-1.5 rounded-pill bg-background-main-secondary px-2.5 py-1 text-xs"
                    >
                      <ActorAvatar
                        actorType={entry.kind}
                        actorId={entry.id}
                        size={16}
                      />
                      {entry.name}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter className="border-t px-6 pt-4 pb-6">
          {step === 1 ? (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button disabled={!name.trim()} onClick={() => setStep(2)}>
                Continue
              </Button>
            </>
          ) : step === 2 ? (
            <>
              <Button variant="outline" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button onClick={() => setStep(3)}>Continue</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep(2)}>
                Back
              </Button>
              <Button onClick={handleCreate} disabled={submitting}>
                {submitting ? 'Creating…' : 'Create team'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
