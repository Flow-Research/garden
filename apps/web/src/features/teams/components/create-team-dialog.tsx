import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useWorkspaceId } from '@garden/app-state/hooks'
import { useAuthStore } from '@garden/app-state/auth'
import type { AddTeamMemberRequest } from '@garden/core/types'
import { ArrowLeft, X } from 'lucide-react'
import { Button } from '@garden/ui/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@garden/ui/components/ui/dialog'
import { Input } from '@garden/ui/components/ui/input'
import { Textarea } from '@garden/ui/components/ui/textarea'
import { toast } from 'sonner'
import { agentListOptions, memberListOptions } from '@/lib/workspace/queries'
import { useCreateTeam } from '../mutations'
import { TeamCreatedToast } from './team-created-toast'

type PickerEntry =
  | { key: string; kind: 'user'; id: string; name: string; email: string }
  | { key: string; kind: 'agent'; id: string; name: string; email: null }

/** Design 26–28 field chrome: gray fill, hairline border. */
const FIELD_CLASS =
  'border-[0.5px] border-border-default bg-background-main-secondary shadow-none placeholder:text-text-tertiary'

/**
 * Single-screen Team creation from designs 26–28. Before, creation was a
 * three-step wizard (details, picker, review) with avatars. Now name,
 * description and the member checklist share one screen with a selection
 * counter, and Create team enables once a name is set. The creator is not
 * listed: the server always makes them owner and member.
 */
export function CreateTeamDialog({ onClose }: { onClose: () => void }) {
  const wsId = useWorkspaceId()
  const currentUserId = useAuthStore((s) => s.user?.id ?? '')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const createTeam = useCreateTeam()
  const membersQuery = useQuery(memberListOptions(wsId))
  const agentsQuery = useQuery(agentListOptions(wsId))

  const entries = useMemo<PickerEntry[]>(() => {
    const users: PickerEntry[] = (membersQuery.data ?? [])
      .filter((member) => member.user_id !== currentUserId)
      .map((member) => ({
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
  }, [membersQuery.data, agentsQuery.data, currentUserId])

  const toggle = (key: string) =>
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const handleCreate = () => {
    if (!name.trim() || createTeam.isPending) return
    const initialMembers: AddTeamMemberRequest[] = entries
      .filter((entry) => selected.has(entry.key))
      .map((entry) =>
        entry.kind === 'user'
          ? { member_type: 'user', user_id: entry.id }
          : { member_type: 'agent', agent_id: entry.id },
      )
    createTeam
      .mutateAsync({
        name: name.trim(),
        description: description.trim() || null,
        initial_members: initialMembers.length > 0 ? initialMembers : undefined,
      })
      .then(
        () => {
          toast.custom(
            () => <TeamCreatedToast title="A new team has been added" />,
            { position: 'top-center' },
          )
          onClose()
        },
        (error: unknown) =>
          toast.error(
            error instanceof Error ? error.message : 'Failed to create team',
          ),
      )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        size="md"
        showCloseButton={false}
        className="gap-0 rounded-2xl p-8"
      >
        <div className="flex items-center justify-between">
          <Button
            aria-label="Back"
            onClick={onClose}
            size="icon-sm"
            variant="ghost"
          >
            <ArrowLeft className="size-4" />
          </Button>
          <Button
            aria-label="Close"
            onClick={onClose}
            size="icon-sm"
            variant="ghost"
          >
            <X className="size-4" />
          </Button>
        </div>
        <DialogTitle className="mt-1 text-center text-xl leading-tight font-semibold">
          Create New Team
        </DialogTitle>
        <DialogDescription className="mt-2 text-center text-sm text-text-secondary">
          Setup and add team members to your team
        </DialogDescription>

        <label
          htmlFor="create-team-name"
          className="mt-12 flex flex-col gap-2 text-sm"
        >
          <span>
            Team name <span className="text-text-danger-default">*</span>
          </span>
          <Input
            id="create-team-name"
            className={`h-10 ${FIELD_CLASS}`}
            maxLength={100}
            onChange={(event) => setName(event.target.value)}
            placeholder="Enter the name of your team"
            value={name}
          />
        </label>
        <label
          htmlFor="create-team-description"
          className="mt-6 flex flex-col gap-2 text-sm"
        >
          <span>Description</span>
          <Textarea
            className={FIELD_CLASS}
            id="create-team-description"
            maxLength={5000}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Enter description here..."
            rows={3}
            value={description}
          />
        </label>

        <div aria-hidden className="mt-6 h-px w-full bg-border-default" />

        <div className="mt-6 flex items-center justify-between text-xs text-text-secondary uppercase">
          <span>Team members</span>
          {entries.length > 0 ? (
            <span className="normal-case">
              {selected.size === 0 ? 'No select' : `${selected.size} select`}
            </span>
          ) : null}
        </div>
        {entries.length === 0 ? (
          <div className="flex flex-col items-center gap-1 py-6 text-center">
            <span className="text-sm">No team member</span>
            <span className="text-xs text-text-secondary">
              Add team members to see them here
            </span>
          </div>
        ) : (
          <ul className="mt-3 flex max-h-56 flex-col overflow-y-auto">
            {entries.map((entry) => (
              <li key={entry.key}>
                <label className="grid cursor-pointer grid-cols-[1fr_1.2fr_auto] items-center gap-4 py-2 text-sm">
                  <span className="truncate">{entry.name}</span>
                  <span className="truncate text-center text-text-secondary">
                    {entry.email ?? 'Agent'}
                  </span>
                  <input
                    aria-label={entry.name}
                    checked={selected.has(entry.key)}
                    className="size-3.5 accent-primary"
                    onChange={() => toggle(entry.key)}
                    type="checkbox"
                  />
                </label>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-6 grid grid-cols-2 gap-2">
          <Button className="h-10" onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button
            className="h-10"
            disabled={!name.trim() || createTeam.isPending}
            onClick={handleCreate}
          >
            {createTeam.isPending ? 'Creating…' : 'Create team'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
