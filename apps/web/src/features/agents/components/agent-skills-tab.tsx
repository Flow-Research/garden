import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import type {
  AgentSkill,
  AgentSkillAssignment,
  Skill,
} from '@garden/core/types'
import {
  DEFAULT_AGENT_PERMISSIONS,
  type AgentPermissions,
} from '@garden/core/agents/permissions'
import { api } from '@/lib/api'
import { useWorkspaceId } from '@garden/app-state/hooks'
import {
  agentDetailOptions,
  agentSkillListOptions,
  skillListOptions,
  workspaceKeys,
} from '@/lib/workspace/queries'
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

  const attachedQuery = useQuery(agentSkillListOptions(wsId, agentId))
  const libraryQuery = useQuery(skillListOptions(wsId))
  const detailQuery = useQuery(agentDetailOptions(agentId))

  const attached = attachedQuery.data ?? []
  const library = libraryQuery.data ?? []
  const assignmentKey = workspaceKeys.agentSkills(wsId, agentId)
  const agentKey = workspaceKeys.agent(agentId)
  const agentPermissions = detailQuery.data?.permissions ?? null
  const fullAccess = agentPermissions?.full_access !== false
  const allowedSlugs = new Set(
    fullAccess ? [] : (agentPermissions?.allowed_skills ?? []),
  )

  const setSkillsMutation = useMutation({
    mutationFn: (skills: AgentSkillAssignment[]) =>
      api.setAgentSkills(agentId, { skills }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: assignmentKey })
      qc.invalidateQueries({ queryKey: workspaceKeys.agent(agentId) })
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : 'Failed to update skills',
      )
    },
  })

  const commit = (next: AgentSkill[]) =>
    setSkillsMutation.mutateAsync(
      next.map((s) => ({ skill_id: s.id, enabled: s.enabled })),
    )

  const handleToggle = async (skillId: string, enabled: boolean) => {
    const next = attached.map((s) => (s.id === skillId ? { ...s, enabled } : s))
    qc.setQueryData<AgentSkill[]>(assignmentKey, next)
    await commit(next).catch(() => {
      qc.setQueryData<AgentSkill[]>(assignmentKey, attached)
    })
  }

  const handleDetach = async (skillId: string) => {
    const next = attached.filter((s) => s.id !== skillId)
    qc.setQueryData<AgentSkill[]>(assignmentKey, next)
    await commit(next).catch(() => {
      qc.setQueryData<AgentSkill[]>(assignmentKey, attached)
    })
    toast.success('Skill detached')
  }

  const permissionsMutation = useMutation({
    mutationFn: (permissions: AgentPermissions) =>
      api.updateAgentPermissions(agentId, permissions),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: agentKey })
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : 'Failed to update permissions',
      )
    },
  })

  const commitPermissions = async (next: AgentPermissions) => {
    qc.setQueryData(agentKey, (previous: unknown) =>
      previous && typeof previous === 'object'
        ? { ...previous, permissions: next }
        : previous,
    )
    await permissionsMutation.mutateAsync(next).catch(() => {
      qc.invalidateQueries({ queryKey: agentKey })
    })
  }

  const handleFullAccessToggle = async (checked: boolean) => {
    const base = agentPermissions ?? DEFAULT_AGENT_PERMISSIONS
    if (checked) {
      await commitPermissions({
        ...base,
        full_access: true,
      })
      return
    }
    await commitPermissions({
      ...base,
      full_access: false,
      allowed_skills: attached.map((s) => s.slug),
    })
  }

  const handleAllowedToggle = async (slug: string, allowed: boolean) => {
    const base = agentPermissions ?? DEFAULT_AGENT_PERMISSIONS
    const next = new Set(
      base.full_access ? attached.map((s) => s.slug) : base.allowed_skills,
    )
    if (allowed) {
      next.add(slug)
    } else {
      next.delete(slug)
    }
    await commitPermissions({
      ...base,
      full_access: false,
      allowed_skills: [...next],
    })
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
    qc.setQueryData<AgentSkill[]>(assignmentKey, next)
    await commit(next).catch(() => {
      qc.setQueryData<AgentSkill[]>(assignmentKey, attached)
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
          <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <Switch
              checked={fullAccess}
              onCheckedChange={(checked) =>
                void handleFullAccessToggle(checked)
              }
              aria-label={
                fullAccess ? 'Restrict skill access' : 'Allow full access'
              }
            />
            {fullAccess
              ? 'Full access: agent may load any attached skill'
              : 'Restricted: agent may load allowed skills only'}
          </label>
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
            <li key={skill.id} className="flex items-center gap-3 px-3 py-2.5">
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
                  checked={fullAccess || allowedSlugs.has(skill.slug)}
                  disabled={fullAccess}
                  onCheckedChange={(checked) =>
                    void handleAllowedToggle(skill.slug, checked)
                  }
                  aria-label={
                    fullAccess
                      ? `${skill.name} allowed by full access`
                      : allowedSlugs.has(skill.slug)
                        ? `Disallow ${skill.name}`
                        : `Allow ${skill.name}`
                  }
                />
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
                          selected ? 'bg-accent/40' : 'hover:bg-accent/30',
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
