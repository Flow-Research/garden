'use client'

import { useEffect, useState } from 'react'
import { Result } from 'better-result'
import { useQuery } from '@tanstack/react-query'
import {
  CheckCircle2,
  Clock,
  Loader2,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
  XCircle,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import type { Agent } from '@garden/core/types'
import type { Automation, AutomationRun, AutomationTrigger } from '@/lib/api'
import { useWorkspaceId } from '@garden/core/hooks'
import { Button } from '@garden/ui/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@garden/ui/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@garden/ui/components/ui/select'
import { Skeleton } from '@garden/ui/components/ui/skeleton'
import { cn } from '@garden/ui/lib/utils'
import { ActorAvatar } from '@/features/common/actor-avatar'
import { useDevSettingsStore } from '@/features/settings/dev-settings-store'
import { useActorName } from '@/lib/workspace/hooks'
import { agentListOptions } from '@/lib/workspace/queries'
import {
  useCreateAutomationTrigger,
  useDeleteAutomation,
  useDeleteAutomationTrigger,
  useTriggerAutomation,
  useUpdateAutomation,
} from './mutations'
import { automationDetailOptions, automationRunsOptions } from './queries'
import {
  TriggerConfigSection,
  getDefaultTriggerConfig,
  toCronExpression,
  type TriggerConfig,
} from './trigger-config'

function formatDate(date: string): string {
  return new Date(date).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function formatTokenCount(value: number) {
  return Intl.NumberFormat(undefined, { notation: 'compact' }).format(value)
}

const RUN_STATUS_CONFIG: Record<
  string,
  { label: string; color: string; icon: typeof CheckCircle2 }
> = {
  queued: {
    label: 'Queued',
    color: 'text-blue-500',
    icon: Clock,
  },
  running: { label: 'Running', color: 'text-blue-500', icon: Loader2 },
  completed: {
    label: 'Completed',
    color: 'text-emerald-500',
    icon: CheckCircle2,
  },
  failed: { label: 'Failed', color: 'text-destructive', icon: XCircle },
  cancelled: { label: 'Cancelled', color: 'text-muted-foreground', icon: Pause },
  skipped: { label: 'Skipped', color: 'text-amber-500', icon: Pause },
}

function RunRow({
  run,
  debugMode = false,
}: {
  run: AutomationRun
  debugMode?: boolean
}) {
  const config =
    RUN_STATUS_CONFIG[run.status] ?? RUN_STATUS_CONFIG.queued
  const StatusIcon = config.icon
  const usage = run.usage_json
  const result = run.result_json
  const totalTokens = numberValue(usage?.total_tokens)
  const model = stringValue(usage?.model)
  const output = stringValue(result?.output)

  return (
    <div className="px-4 py-2.5 text-sm transition-colors hover:bg-accent/30">
      <div className="flex items-center gap-3">
        <StatusIcon className={cn('size-4 shrink-0', config.color)} />
        <span
          className={cn('w-24 shrink-0 text-xs font-medium', config.color)}
        >
          {config.label}
        </span>
        <span className="w-16 shrink-0 text-xs text-muted-foreground capitalize">
          {run.source}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {run.failure_reason ? (
            <span className="text-destructive">{run.failure_reason}</span>
          ) : output ? (
            output
          ) : run.run_id ? (
            <span className="font-mono">{run.run_id.slice(0, 8)}</span>
          ) : null}
          {debugMode && (totalTokens !== null || model) ? (
            <span className="ml-2 text-[11px] text-muted-foreground">
              {totalTokens !== null
                ? `${formatTokenCount(totalTokens)} tokens`
                : 'usage'}
              {model ? ` · ${model}` : null}
            </span>
          ) : null}
        </span>
        <span className="w-32 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
          {run.triggered_at || run.created_at
            ? formatDate(run.triggered_at ?? run.created_at ?? '')
            : '--'}
        </span>
      </div>
      {output && output.length > 120 ? (
        <p className="mt-1 line-clamp-2 pl-[7.75rem] text-xs leading-5 text-muted-foreground">
          {output}
        </p>
      ) : null}
    </div>
  )
}
function TriggerRow({
  trigger,
  automationId,
}: {
  trigger: AutomationTrigger
  automationId: string
}) {
  const deleteTrigger = useDeleteAutomationTrigger()

  const handleDelete = async () => {
    const result = await Result.tryPromise(() =>
      deleteTrigger.mutateAsync({ automationId, triggerId: trigger.id }),
    )
    if (Result.isError(result)) {
      toast.error(
        result.error instanceof Error
          ? result.error.message
          : 'Failed to delete trigger',
      )
      return
    }
    toast.success('Trigger deleted')
  }

  return (
    <div className="flex items-center gap-3 rounded-md border px-3 py-2">
      <Clock className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium capitalize">{trigger.kind}</span>
          {trigger.label ? (
            <span className="text-xs text-muted-foreground">
              ({trigger.label})
            </span>
          ) : null}
          {!trigger.enabled ? (
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
              Disabled
            </span>
          ) : null}
        </div>
        {trigger.cron_expression ? (
          <div className="mt-0.5 text-xs text-muted-foreground">
            {trigger.cron_expression}
            {trigger.timezone ? ` (${trigger.timezone})` : null}
          </div>
        ) : null}
        {trigger.next_run_at ? (
          <div className="text-xs text-muted-foreground">
            Next: {formatDate(trigger.next_run_at)}
          </div>
        ) : null}
      </div>
      <Button
        size="icon"
        variant="ghost"
        className="size-7 shrink-0"
        onClick={handleDelete}
      >
        <Trash2 className="size-3.5 text-muted-foreground" />
      </Button>
    </div>
  )
}

const PRIORITY_OPTIONS = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: 'none', label: 'None' },
]

function EditAutomationDialog({
  open,
  onOpenChange,
  automation,
  agents,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  automation: Automation
  agents: Agent[]
}) {
  const updateAutomation = useUpdateAutomation()
  const [title, setTitle] = useState(automation.title)
  const [description, setDescription] = useState(automation.description ?? '')
  const [assigneeId, setAssigneeId] = useState(automation.assignee_agent_id)
  const [priority, setPriority] = useState(automation.priority)

  useEffect(() => {
    setTitle(automation.title)
    setDescription(automation.description ?? '')
    setAssigneeId(automation.assignee_agent_id)
    setPriority(automation.priority)
  }, [automation])

  const activeAgents = agents.filter((agent) => !agent.archived_at)
  const submitting = updateAutomation.isPending

  const handleSubmit = async () => {
    if (!title.trim() || !assigneeId || submitting) return
    const result = await Result.tryPromise(() =>
      updateAutomation.mutateAsync({
        id: automation.id,
        title: title.trim(),
        description: description.trim() || null,
        assignee_agent_id: assigneeId,
        priority,
      }),
    )
    if (Result.isError(result)) {
      toast.error(
        result.error instanceof Error
          ? result.error.message
          : 'Failed to update automation',
      )
      return
    }
    onOpenChange(false)
    toast.success('Automation updated')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogTitle>Edit Automation</DialogTitle>
        <div className="space-y-4 pt-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Name
            </label>
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Prompt
            </label>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={6}
              className="mt-1 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Agent
              </label>
              <Select
                value={assigneeId}
                onValueChange={(value) => value && setAssigneeId(value)}
              >
                <SelectTrigger className="mt-1 w-full">
                  <SelectValue placeholder="Select agent..." />
                </SelectTrigger>
                <SelectContent>
                  {activeAgents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Priority
              </label>
              <Select
                value={priority}
                onValueChange={(value) =>
                  value && setPriority(value as Automation['priority'])
                }
              >
                <SelectTrigger className="mt-1 w-full">
                  <SelectValue placeholder="Medium" />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!title.trim() || !assigneeId || submitting}
            >
              {submitting ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function AddTriggerDialog({
  open,
  onOpenChange,
  automationId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  automationId: string
}) {
  const createTrigger = useCreateAutomationTrigger()
  const [config, setConfig] = useState<TriggerConfig>(getDefaultTriggerConfig)
  const [label, setLabel] = useState('')

  const handleSubmit = async () => {
    const cronExpression = toCronExpression(config)
    if (createTrigger.isPending || !cronExpression.trim()) return
    const result = await Result.tryPromise(() =>
      createTrigger.mutateAsync({
        automationId,
        kind: 'schedule',
        cron_expression: cronExpression,
        timezone: config.timezone,
        label: label.trim() || null,
      }),
    )
    if (Result.isError(result)) {
      toast.error(
        result.error instanceof Error
          ? result.error.message
          : 'Failed to add trigger',
      )
      return
    }
    onOpenChange(false)
    setConfig(getDefaultTriggerConfig())
    setLabel('')
    toast.success('Trigger added')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogTitle>Add Trigger</DialogTitle>
        <div className="space-y-4 pt-2">
          <TriggerConfigSection config={config} onChange={setConfig} />
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Label (optional)
            </label>
            <input
              type="text"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="e.g. Weekday morning"
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="flex justify-end pt-1">
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={createTrigger.isPending}
            >
              {createTrigger.isPending ? 'Adding...' : 'Add trigger'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function AutomationDetailPage({
  automationId,
  onBack,
  onDeleted,
}: {
  automationId: string
  onBack?: () => void
  onDeleted?: () => void
}) {
  const wsId = useWorkspaceId()
  const debugMode = useDevSettingsStore((state) => state.debugMode)
  const { getActorName } = useActorName()
  const { data, isLoading } = useQuery(
    automationDetailOptions(wsId, automationId),
  )
  const { data: runs = [], isLoading: runsLoading } = useQuery(
    automationRunsOptions(wsId, automationId, debugMode),
  )
  const { data: agents = [] } = useQuery(agentListOptions(wsId))
  const updateAutomation = useUpdateAutomation()
  const deleteAutomation = useDeleteAutomation()
  const triggerAutomation = useTriggerAutomation()
  const [triggerDialogOpen, setTriggerDialogOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Automation not found
      </div>
    )
  }

  const { automation, triggers } = data

  const handleRunNow = async () => {
    const result = await Result.tryPromise(() =>
      triggerAutomation.mutateAsync(automationId),
    )
    if (Result.isError(result)) {
      toast.error(
        result.error instanceof Error
          ? result.error.message
          : 'Failed to trigger automation',
      )
      return
    }
    toast.success('Automation triggered')
  }

  const handleDelete = async () => {
    const result = await Result.tryPromise(() =>
      deleteAutomation.mutateAsync(automationId),
    )
    if (Result.isError(result)) {
      toast.error(
        result.error instanceof Error
          ? result.error.message
          : 'Failed to delete automation',
      )
      return
    }
    toast.success('Automation deleted')
    onDeleted?.()
  }

  const handleToggleStatus = () => {
    const nextStatus = automation.status === 'active' ? 'paused' : 'active'
    updateAutomation.mutate({ id: automationId, status: nextStatus })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between border-b px-5">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            className="text-muted-foreground transition-colors hover:text-foreground"
            onClick={onBack}
          >
            <Zap className="size-4" />
          </button>
          <span className="text-muted-foreground">/</span>
          <h1 className="truncate text-sm font-medium">{automation.title}</h1>
          <span
            className={cn(
              'ml-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium capitalize',
              automation.status === 'active'
                ? 'bg-emerald-500/10 text-emerald-500'
                : automation.status === 'paused'
                  ? 'bg-amber-500/10 text-amber-500'
                  : 'bg-muted text-muted-foreground',
            )}
          >
            {automation.status}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setEditDialogOpen(true)}
          >
            <Pencil className="mr-1 size-3.5" />
            Edit
          </Button>
          <Button size="sm" variant="outline" onClick={handleToggleStatus}>
            {automation.status === 'active' ? (
              <>
                <Pause className="mr-1 size-3.5" /> Pause
              </>
            ) : (
              <>
                <Play className="mr-1 size-3.5" /> Activate
              </>
            )}
          </Button>
          <Button
            size="sm"
            onClick={handleRunNow}
            disabled={
              automation.status !== 'active' || triggerAutomation.isPending
            }
          >
            <Play className="mr-1 size-3.5" />
            {triggerAutomation.isPending ? 'Running...' : 'Run now'}
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl space-y-8 p-6">
          <section className="space-y-4">
            <h2 className="text-sm font-medium tracking-wider text-muted-foreground uppercase">
              Properties
            </h2>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <label className="text-xs text-muted-foreground">Agent</label>
                <div className="mt-1 flex items-center gap-2">
                  <ActorAvatar
                    actorType="agent"
                    actorId={automation.assignee_agent_id}
                    size={20}
                  />
                  <span>
                    {getActorName('agent', automation.assignee_agent_id)}
                  </span>
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">
                  Priority
                </label>
                <div className="mt-1 capitalize">{automation.priority}</div>
              </div>
              {automation.description ? (
                <div className="col-span-2">
                  <label className="text-xs text-muted-foreground">
                    Prompt
                  </label>
                  <div className="mt-1 whitespace-pre-wrap text-sm">
                    {automation.description}
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium tracking-wider text-muted-foreground uppercase">
                Triggers
              </h2>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setTriggerDialogOpen(true)}
              >
                <Plus className="mr-1 size-3.5" />
                Add trigger
              </Button>
            </div>
            {triggers.length === 0 ? (
              <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                No triggers configured. Add a schedule to run automatically.
              </div>
            ) : (
              <div className="space-y-2">
                {triggers.map((trigger) => (
                  <TriggerRow
                    key={trigger.id}
                    trigger={trigger}
                    automationId={automationId}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-medium tracking-wider text-muted-foreground uppercase">
              Run History
            </h2>
            {runsLoading ? (
              <div className="space-y-1">
                {Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton key={index} className="h-10 w-full" />
                ))}
              </div>
            ) : runs.length === 0 ? (
              <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                No runs yet. Click &quot;Run now&quot; to trigger manually.
              </div>
            ) : (
              <div className="overflow-hidden rounded-md border">
                {runs.map((run) => (
                  <RunRow key={run.id} run={run} debugMode={debugMode} />
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3 border-t pt-4">
            <h2 className="text-sm font-medium tracking-wider text-destructive uppercase">
              Danger Zone
            </h2>
            <Button size="sm" variant="destructive" onClick={handleDelete}>
              <Trash2 className="mr-1 size-3.5" />
              Delete automation
            </Button>
          </section>
        </div>
      </div>

      <AddTriggerDialog
        open={triggerDialogOpen}
        onOpenChange={setTriggerDialogOpen}
        automationId={automationId}
      />
      <EditAutomationDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        automation={automation}
        agents={agents}
      />
    </div>
  )
}
