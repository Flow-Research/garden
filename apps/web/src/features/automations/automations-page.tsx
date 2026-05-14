'use client'

import { useState } from 'react'
import { Result } from 'better-result'
import { useQuery } from '@tanstack/react-query'
import {
  AlertCircle,
  BarChart3,
  Bug,
  FileSearch,
  GitPullRequest,
  Newspaper,
  Pause,
  Play,
  Plus,
  Shield,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import type { Agent } from '@garden/core/types'
import type { Automation, AutomationListItem } from '@/lib/api'
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
import { ActorAvatar as ActorAvatarBase } from '@garden/ui/components/common/actor-avatar'
import { cn } from '@garden/ui/lib/utils'
import { agentListOptions } from '@/lib/workspace/queries'
import { automationListOptions } from './queries'
import { useCreateAutomation } from './mutations'
import {
  TriggerConfigSection,
  getDefaultTriggerConfig,
  toCronExpression,
  type TriggerConfig,
  type TriggerFrequency,
} from './trigger-config'

type AutomationTemplate = {
  title: string
  prompt: string
  summary: string
  icon: typeof Zap
  frequency: TriggerFrequency
  time: string
}

type AutomationOpenTarget = Pick<Automation, 'id' | 'title'>

const TEMPLATES: AutomationTemplate[] = [
  {
    title: 'Daily news digest',
    summary: "Search and summarize today's news for the team",
    prompt: `1. Search the web for news and announcements published today only (strictly today's date)
2. Filter for topics relevant to our team and industry
3. For each item, write a short summary including: title, source, key takeaways
4. Compile everything into a single digest post
5. Return the digest as the automation run report, including any recommended recipients`,
    icon: Newspaper,
    frequency: 'daily',
    time: '09:00',
  },
  {
    title: 'PR review reminder',
    summary: 'Flag stale pull requests that need review',
    prompt: `1. List all open pull requests in the repository
2. Identify PRs that have been open for more than 24 hours without a review
3. For each stale PR, note the author, age, and a one-line summary of the change
4. Return a stale PR report with links and recommended reviewers
5. Include a concise team-facing reminder in the run output`,
    icon: GitPullRequest,
    frequency: 'weekdays',
    time: '10:00',
  },
  {
    title: 'Bug triage',
    summary: 'Assess and prioritize new bug reports',
    prompt: `1. List all issues with status "triage" or "backlog" that have not been prioritized
2. For each issue, read the description and any attached logs or screenshots
3. Assess severity (critical / high / medium / low) based on user impact and scope
4. Set the priority field on the issue accordingly
5. Return a triage report explaining each assessment and suggested next steps`,
    icon: Bug,
    frequency: 'weekdays',
    time: '09:00',
  },
  {
    title: 'Weekly progress report',
    summary: 'Compile a weekly summary of team progress',
    prompt: `1. Gather all issues completed (status "done") in the past 7 days
2. Gather all issues currently in progress
3. Identify any blocked issues and their blockers
4. Calculate key metrics: issues closed, issues opened, net change
5. Write a structured weekly report with sections: Completed, In Progress, Blocked, Metrics
6. Return the report as the automation run output`,
    icon: BarChart3,
    frequency: 'weekly',
    time: '17:00',
  },
  {
    title: 'Dependency audit',
    summary: 'Scan for security vulnerabilities and outdated packages',
    prompt: `1. Run dependency audit tools on the project (npm audit, go vuln check, etc.)
2. Identify any packages with known security vulnerabilities
3. List outdated packages that are more than 2 major versions behind
4. For each finding, note the severity, affected package, and recommended fix
5. Return a summary report with actionable items`,
    icon: Shield,
    frequency: 'weekly',
    time: '08:00',
  },
  {
    title: 'Documentation check',
    summary: 'Review recent changes for documentation gaps',
    prompt: `1. List all code changes merged in the past 7 days (via git log)
2. For each significant change, check if related documentation was updated
3. Identify any new APIs, config options, or features missing documentation
4. Create a list of documentation gaps with file paths and suggested content
5. Return the findings as the automation run output`,
    icon: FileSearch,
    frequency: 'weekly',
    time: '14:00',
  },
]

function formatRelativeDate(date: string): string {
  const diff = Date.now() - new Date(date).getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  if (days < 1) return 'Today'
  if (days === 1) return '1d ago'
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; icon: typeof Zap }
> = {
  active: { label: 'Active', color: 'text-emerald-500', icon: Play },
  paused: { label: 'Paused', color: 'text-amber-500', icon: Pause },
  archived: {
    label: 'Archived',
    color: 'text-muted-foreground',
    icon: AlertCircle,
  },
}

function AutomationRow({
  automation,
  onOpenAutomation,
}: {
  automation: AutomationListItem
  onOpenAutomation?: (automation: AutomationOpenTarget) => void
}) {
  const statusConfig = STATUS_CONFIG[automation.status] ?? STATUS_CONFIG.active
  const StatusIcon = statusConfig.icon
  const agentName = automation.assignee_agent_name ?? 'Unknown Agent'

  return (
    <button
      type="button"
      className="group/row flex h-11 w-full items-center gap-2 px-5 text-left text-sm transition-colors hover:bg-accent/40"
      onClick={() => onOpenAutomation?.(automation)}
    >
      <Zap className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate font-medium">
        {automation.title}
      </span>
      <span className="flex w-32 shrink-0 items-center gap-1.5">
        <ActorAvatarBase
          name={agentName}
          initials={agentName
            .split(' ')
            .map((word) => word[0])
            .join('')
            .toUpperCase()
            .slice(0, 2)}
          avatarUrl={null}
          isAgent
          size={18}
        />
        <span className="truncate text-xs text-muted-foreground">
          {agentName}
        </span>
      </span>
      <span
        className={cn(
          'flex w-20 shrink-0 items-center justify-center gap-1 text-xs',
          statusConfig.color,
        )}
      >
        <StatusIcon className="size-3" />
        {statusConfig.label}
      </span>
      <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {automation.last_run_at
          ? formatRelativeDate(automation.last_run_at)
          : '--'}
      </span>
    </button>
  )
}

function CreateAutomationDialog({
  open,
  onOpenChange,
  template,
  agents,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  template?: AutomationTemplate | null
  agents: Agent[]
  onCreated?: (automation: Automation) => void
}) {
  const createAutomation = useCreateAutomation()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [triggerConfig, setTriggerConfig] = useState<TriggerConfig>(
    getDefaultTriggerConfig,
  )
  const [appliedTemplate, setAppliedTemplate] = useState<
    AutomationTemplate | null | undefined
  >(null)

  if (template !== appliedTemplate && open) {
    setAppliedTemplate(template)
    if (template) {
      setTitle(template.title)
      setDescription(template.prompt)
      setTriggerConfig({
        ...getDefaultTriggerConfig(),
        frequency: template.frequency,
        time: template.time,
      })
    }
  }

  const activeAgents = agents.filter((agent) => !agent.archived_at)
  const submitting = createAutomation.isPending

  const handleSubmit = async () => {
    if (!title.trim() || !assigneeId || submitting) return
    const result = await Result.tryPromise(() =>
      createAutomation.mutateAsync({
        title: title.trim(),
        description: description.trim() || null,
        assignee_agent_id: assigneeId,
        priority: 'medium',
        trigger: {
          kind: 'schedule',
          cron_expression: toCronExpression(triggerConfig),
          timezone: triggerConfig.timezone,
        },
      }),
    )
    if (Result.isError(result)) {
      toast.error(
        result.error instanceof Error
          ? result.error.message
          : 'Failed to create automation',
      )
      return
    }
    onOpenChange(false)
    setTitle('')
    setDescription('')
    setAssigneeId('')
    setTriggerConfig(getDefaultTriggerConfig())
    toast.success('Automation created')
    onCreated?.(result.value.automation)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogTitle>New Automation</DialogTitle>
        <div className="space-y-5 pt-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Name
            </label>
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. Daily code review"
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
              placeholder="Step-by-step instructions for the agent..."
              rows={6}
              className="mt-1 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
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
              Schedule
            </label>
            <div className="mt-2">
              <TriggerConfigSection
                config={triggerConfig}
                onChange={setTriggerConfig}
              />
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
              {submitting ? 'Creating...' : 'Create'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function AutomationsPage({
  onOpenAutomation,
}: {
  onOpenAutomation?: (automation: AutomationOpenTarget) => void
}) {
  const wsId = useWorkspaceId()
  const { data, isLoading } = useQuery(automationListOptions(wsId))
  const automations = data?.automations ?? []
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedTemplate, setSelectedTemplate] =
    useState<AutomationTemplate | null>(null)
  const { data: agents = [] } = useQuery({
    ...agentListOptions(wsId),
    enabled: createOpen,
  })

  const openCreate = (template?: AutomationTemplate) => {
    setSelectedTemplate(template ?? null)
    setCreateOpen(true)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between border-b px-5">
        <div className="flex items-center gap-2">
          <Zap className="size-4 text-muted-foreground" />
          <h1 className="text-sm font-medium">Automations</h1>
          {!isLoading && automations.length > 0 ? (
            <span className="text-xs tabular-nums text-muted-foreground">
              {automations.length}
            </span>
          ) : null}
        </div>
        <Button size="sm" variant="outline" onClick={() => openCreate()}>
          <Plus className="mr-1 size-3.5" />
          New automation
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-1 p-5">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-11 w-full" />
            ))}
          </div>
        ) : automations.length === 0 ? (
          <div className="flex flex-col items-center px-5 py-16">
            <Zap className="mb-3 size-10 text-muted-foreground opacity-30" />
            <p className="text-sm text-muted-foreground">No automations yet</p>
            <p className="mt-1 mb-6 max-w-lg text-center text-xs text-muted-foreground">
              Schedule recurring tasks for your AI agents. Pick a template or
              start from scratch.
            </p>
            <div className="grid w-full max-w-3xl grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {TEMPLATES.map((template) => {
                const Icon = template.icon
                return (
                  <button
                    key={template.title}
                    type="button"
                    className="flex items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent/40"
                    onClick={() => openCreate(template)}
                  >
                    <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <div className="text-sm font-medium">
                        {template.title}
                      </div>
                      <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {template.summary}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="mt-4"
              onClick={() => openCreate()}
            >
              <Plus className="mr-1 size-3.5" />
              Start from scratch
            </Button>
          </div>
        ) : (
          <>
            <div className="sticky top-0 z-[1] flex h-8 items-center gap-2 border-b bg-muted/30 px-5 text-xs font-medium text-muted-foreground">
              <span className="w-4 shrink-0" />
              <span className="min-w-0 flex-1">Name</span>
              <span className="w-32 shrink-0">Agent</span>
              <span className="w-20 shrink-0 text-center">Status</span>
              <span className="w-20 shrink-0 text-right">Last run</span>
            </div>
            {automations.map((automation) => (
              <AutomationRow
                key={automation.id}
                automation={automation}
                onOpenAutomation={onOpenAutomation}
              />
            ))}
          </>
        )}
      </div>

      <CreateAutomationDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        template={selectedTemplate}
        agents={agents}
        onCreated={onOpenAutomation}
      />
    </div>
  )
}
