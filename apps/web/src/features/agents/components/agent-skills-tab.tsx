'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import type {
  AgentSkill,
  AgentSkillAssignment,
  Skill,
} from '@garden/core/types'
import { api } from '@/lib/api'
import { useWorkspaceId } from '@garden/core/hooks'
import {
  agentSkillListOptions,
  skillListOptions,
  workspaceKeys,
} from '@garden/core/workspace/queries'
import { Button } from '@garden/ui/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@garden/ui/components/ui/dialog'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@garden/ui/components/ui/empty'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@garden/ui/components/ui/input-group'
import { Skeleton } from '@garden/ui/components/ui/skeleton'
import { Switch } from '@garden/ui/components/ui/switch'
import { cn } from '@garden/ui/lib/utils'

export function AgentSkillsTab({
  agentId,
  onOpenSkill,
}: {
  agentId: string
  onOpenSkill: (skillId: string, name: string) => void
}) {
  const wsId = useWorkspaceId()
  const qc = useQueryClient()
  const [pickerOpen, setPickerOpen] = useState(false)

  const attachedQuery = useQuery(agentSkillListOptions(agentId))
  const libraryQuery = useQuery(skillListOptions(wsId))

  const attached = attachedQuery.data ?? []
  const library = libraryQuery.data ?? []

  const setSkillsMutation = useMutation({
    mutationFn: (skills: AgentSkillAssignment[]) =>
      api.setAgentSkills(agentId, { skills }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workspaceKeys.agentSkills(agentId) })
      qc.invalidateQueries({ queryKey: workspaceKeys.agent(agentId) })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to update skills')
    },
  })

  const commit = (next: AgentSkill[]) =>
    setSkillsMutation.mutateAsync(
      next.map((s) => ({ skill_id: s.id, enabled: s.enabled })),
    )

  const handleToggle = async (skillId: string, enabled: boolean) => {
    const next = attached.map((s) =>
      s.id === skillId ? { ...s, enabled } : s,
    )
    qc.setQueryData<AgentSkill[]>(workspaceKeys.agentSkills(agentId), next)
    await commit(next).catch(() => {
      qc.setQueryData<AgentSkill[]>(workspaceKeys.agentSkills(agentId), attached)
    })
  }

  const handleDetach = async (skillId: string) => {
    const next = attached.filter((s) => s.id !== skillId)
    qc.setQueryData<AgentSkill[]>(workspaceKeys.agentSkills(agentId), next)
    await commit(next).catch(() => {
      qc.setQueryData<AgentSkill[]>(workspaceKeys.agentSkills(agentId), attached)
    })
    toast.success('Skill detached')
  }

  const handleAttach = async (ids: string[]) => {
    const existing = new Map(attached.map((s) => [s.id, s]))
    const additions = ids
      .filter((id) => !existing.has(id))
      .map((id): AgentSkill | null => {
        const skill = library.find((s) => s.id === id)
        if (!skill) return null
        return { ...skill, enabled: true }
      })
      .filter((s): s is AgentSkill => s !== null)
    if (additions.length === 0) return
    const next = [...attached, ...additions]
    qc.setQueryData<AgentSkill[]>(workspaceKeys.agentSkills(agentId), next)
    await commit(next).catch(() => {
      qc.setQueryData<AgentSkill[]>(workspaceKeys.agentSkills(agentId), attached)
    })
    toast.success(
      additions.length === 1
        ? 'Skill attached'
        : `${additions.length} skills attached`,
    )
  }

  if (attachedQuery.isPending) {
    return <SkillsTabSkeleton />
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Skills
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {attached.length === 0
              ? 'No skills attached yet.'
              : `${attached.length} attached`}
          </p>
        </div>
        <Button size="sm" onClick={() => setPickerOpen(true)}>
          <Plus />
          Attach skill
        </Button>
      </div>

      {attached.length === 0 ? (
        <Empty className="border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Sparkles />
            </EmptyMedia>
            <EmptyTitle>No skills yet</EmptyTitle>
            <EmptyDescription>
              Attach skills from your library to teach this agent how to handle
              specific tasks.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" onClick={() => setPickerOpen(true)}>
              Browse library
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <ul className="flex flex-col divide-y divide-border/60 rounded-md border">
          {attached.map((skill) => (
            <li
              key={skill.id}
              className="flex items-center gap-3 px-3 py-2.5"
            >
              <button
                type="button"
                onClick={() => onOpenSkill(skill.id, skill.name)}
                className="flex min-w-0 flex-1 flex-col items-start text-left"
              >
                <span className="truncate text-sm font-medium text-foreground">
                  {skill.name}
                </span>
                {skill.description ? (
                  <span className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                    {skill.description}
                  </span>
                ) : null}
              </button>
              <div className="flex shrink-0 items-center gap-2">
                <Switch
                  checked={skill.enabled}
                  onCheckedChange={(checked) =>
                    void handleToggle(skill.id, checked)
                  }
                  aria-label={skill.enabled ? 'Disable skill' : 'Enable skill'}
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => void handleDetach(skill.id)}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="Detach skill"
                >
                  <X />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {pickerOpen ? (
        <AttachSkillsDialog
          library={library}
          attachedIds={new Set(attached.map((s) => s.id))}
          isLoading={libraryQuery.isPending}
          onClose={() => setPickerOpen(false)}
          onAttach={async (ids) => {
            await handleAttach(ids)
            setPickerOpen(false)
          }}
        />
      ) : null}
    </div>
  )
}

function AttachSkillsDialog({
  library,
  attachedIds,
  isLoading,
  onClose,
  onAttach,
}: {
  library: Skill[]
  attachedIds: Set<string>
  isLoading: boolean
  onClose: () => void
  onAttach: (ids: string[]) => Promise<void>
}) {
  const [filter, setFilter] = useState('')
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)

  const candidates = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return library
      .filter((s) => !attachedIds.has(s.id))
      .filter(
        (s) =>
          !q ||
          s.name.toLowerCase().includes(q) ||
          (s.description?.toLowerCase().includes(q) ?? false),
      )
  }, [library, attachedIds, filter])

  const toggle = (id: string) => {
    setSelection((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSubmit = async () => {
    if (selection.size === 0 || submitting) return
    setSubmitting(true)
    await onAttach(Array.from(selection)).finally(() => setSubmitting(false))
  }

  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value) onClose()
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            Attach skills
          </DialogTitle>
          <DialogDescription className="text-xs">
            Pick from your workspace library.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <InputGroup>
            <InputGroupAddon>
              <Search className="text-muted-foreground" />
            </InputGroupAddon>
            <InputGroupInput
              autoFocus
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter library"
            />
          </InputGroup>

          <div className="max-h-72 overflow-y-auto rounded-md border">
            {isLoading ? (
              <div className="space-y-2 p-3">
                {Array.from({ length: 4 }).map((_, idx) => (
                  <Skeleton key={idx} className="h-9 w-full" />
                ))}
              </div>
            ) : candidates.length === 0 ? (
              <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                {library.length === 0
                  ? 'No skills in library yet.'
                  : 'Everything is already attached or filtered out.'}
              </div>
            ) : (
              <ul className="divide-y divide-border/60">
                {candidates.map((skill) => {
                  const selected = selection.has(skill.id)
                  return (
                    <li key={skill.id}>
                      <button
                        type="button"
                        onClick={() => toggle(skill.id)}
                        className={cn(
                          'flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors',
                          selected
                            ? 'bg-accent/40'
                            : 'hover:bg-accent/30',
                        )}
                      >
                        <span
                          className={cn(
                            'flex size-4 shrink-0 items-center justify-center rounded-sm border transition-colors',
                            selected
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border',
                          )}
                          aria-hidden="true"
                        >
                          {selected ? (
                            <svg
                              className="size-3"
                              viewBox="0 0 12 12"
                              fill="none"
                            >
                              <path
                                d="M2 6.5L4.5 9L10 3.5"
                                stroke="currentColor"
                                strokeWidth="1.6"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          ) : null}
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-sm font-medium text-foreground">
                            {skill.name}
                          </span>
                          {skill.description ? (
                            <span className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                              {skill.description}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={selection.size === 0 || submitting}
            onClick={handleSubmit}
          >
            {submitting
              ? 'Attaching'
              : selection.size === 0
                ? 'Attach'
                : `Attach ${selection.size}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SkillsTabSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-24 rounded-md" />
      </div>
      {Array.from({ length: 3 }).map((_, idx) => (
        <Skeleton key={idx} className="h-12 w-full rounded-md" />
      ))}
    </div>
  )
}
