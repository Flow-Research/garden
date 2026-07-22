import { useState } from 'react'
import { Result } from 'better-result'
import { useQuery } from '@tanstack/react-query'
import {
  AlertCircle,
  BarChart3,
  Bug,
  ChevronDown,
  FileSearch,
  GitPullRequest,
  Newspaper,
  Pause,
  Play,
  Plus,
  Shield,
  Sparkles,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  BUILTIN_AUTOMATION_TEMPLATES,
  createAutomationExecutionConfig,
  type AutomationTemplateDefinition,
} from '@garden/core/automations/templates'
import type { Agent, Skill } from '@garden/core/types'
import type { Automation, AutomationListItem } from '@/lib/api'
import { useWorkspaceId } from '@garden/app-state/hooks'
import { Button } from '@garden/ui/components/ui/button'
import { Checkbox } from '@garden/ui/components/ui/checkbox'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@garden/ui/components/ui/collapsible'
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
import {
  agentListOptions,
  connectionListOptions,
  skillListOptions,
} from '@/lib/workspace/queries'
import { automationListOptions } from './queries'
import { useCreateAutomation } from './mutations'
import {
  TriggerConfigSection,
  toCronExpression,
  type TriggerConfig,
  type TriggerFrequency,
} from './trigger-config'
import { useCreateAutomationDialogStore } from './create-automation-dialog-store'

type AutomationTemplate = {
  title: string
  prompt: string
  summary: string
  icon: typeof Zap
  frequency: TriggerFrequency
  time: string
  category?: string
  tags?: string[]
  systemPrompt?: string
  executionConfig?: AutomationTemplateDefinition['executionConfig']
  outputConfig?: AutomationTemplateDefinition['outputConfig']
  templateSource?: string
}

type AutomationOpenTarget = Pick<Automation, 'id' | 'title'>

function skillSlug(skill: Skill) {
  return skill.slug ?? skill.name
}

const TEMPLATE_ICONS: Record<string, typeof Zap> = {
  'qa-sweep': Shield,
}

const registryTemplates: AutomationTemplate[] =
  BUILTIN_AUTOMATION_TEMPLATES.map((template) => ({
    title: template.title,
    summary: template.summary,
    prompt: template.prompt,
    systemPrompt: template.systemPrompt,
    icon: TEMPLATE_ICONS[template.id] ?? Zap,
    frequency: 'weekly',
    time: '09:00',
    category: template.category,
    tags: template.tags,
    templateSource: template.templateSource,
    executionConfig: template.executionConfig,
    outputConfig: template.outputConfig,
  }))

const TEMPLATES: AutomationTemplate[] = [
  ...registryTemplates,
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
    prompt: `1. List all issues with status "todo" that have not been prioritized
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
  active: { label: 'Active', color: 'text-sage', icon: Play },
  paused: { label: 'Paused', color: 'text-amber', icon: Pause },
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

/**
 * Garden automation creation dialog.
 *
 * Why this exists: prior versions stacked 7 equal-weight sections inside a
 * 44rem dialog with three sibling collapsibles, no hierarchy, generic
 * emerald accent, and a horizontal-scroll template strip that read as
 * sloppy (variable widths, "are there more?", duplicated icon-tile chrome).
 * The Garden design system (docs/design.md, docs/vibe.md) calls for warm
 * parchment + vellum surfaces, hairline borders, the Moss/Sage/Amber/Clay
 * foliage palette, and Geist type — not emerald + generic shadcn neutrals.
 *
 * Intended behavior: 32rem focused column, sticky header with a Simple /
 * Advanced segmented toggle (Simple is the default — Tools & Skills are
 * derived from the chosen template; Advanced exposes them inline). The
 * template chooser is a tidy 2-column grid of compact rows with an
 * always-visible detail panel below the selected row that shows the prompt
 * preview, required connectors, required skills, and the suggested cadence
 * — so users actually understand what each template will produce. Moss is
 * the sole accent; surfaces use vellum / hairline tokens so light and dark
 * modes flow from the same code.
 */
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
  const wsId = useWorkspaceId()
  const createAutomation = useCreateAutomation()
  // Pure consumers: workspace-layout warms these caches upstream at mount,
  // so by the time the dialog opens the data is already there and these
  // hooks just subscribe — the dialog is not a caller.
  const { data: skills = [] } = useQuery({
    ...skillListOptions(wsId),
    enabled: open,
  })
  const { data: connections } = useQuery({
    ...connectionListOptions(wsId),
    enabled: open,
  })
  const liveConnectors = (connections?.integrations ?? []).filter(
    (integration) =>
      integration.status === 'connected' || integration.status === 'degraded',
  )
  const title = useCreateAutomationDialogStore((state) => state.title)
  const description = useCreateAutomationDialogStore(
    (state) => state.description,
  )
  const assigneeId = useCreateAutomationDialogStore((state) => state.assigneeId)
  const triggerConfig = useCreateAutomationDialogStore(
    (state) => state.triggerConfig,
  )
  const selectedTemplate = useCreateAutomationDialogStore(
    (state) => state.selectedTemplate,
  )
  const selectedSkillSlugs = useCreateAutomationDialogStore(
    (state) => state.selectedSkillSlugs,
  )
  const selectedConnectorIds = useCreateAutomationDialogStore(
    (state) => state.selectedConnectorIds,
  )
  const selectedToolNames = useCreateAutomationDialogStore(
    (state) => state.selectedToolNames,
  )
  const setTitle = useCreateAutomationDialogStore((state) => state.setTitle)
  const setDescription = useCreateAutomationDialogStore(
    (state) => state.setDescription,
  )
  const setAssigneeId = useCreateAutomationDialogStore(
    (state) => state.setAssigneeId,
  )
  const setTriggerConfig = useCreateAutomationDialogStore(
    (state) => state.setTriggerConfig,
  )
  const toggleSkillSlug = useCreateAutomationDialogStore(
    (state) => state.toggleSkillSlug,
  )
  const toggleConnectorId = useCreateAutomationDialogStore(
    (state) => state.toggleConnectorId,
  )
  const toggleToolName = useCreateAutomationDialogStore(
    (state) => state.toggleToolName,
  )
  const applyTemplate = useCreateAutomationDialogStore(
    (state) => state.applyTemplate,
  )
  const resetDraft = useCreateAutomationDialogStore((state) => state.reset)
  const [appliedTemplate, setAppliedTemplate] = useState<
    AutomationTemplate | null | undefined
  >(null)
  const [expandedConnectorId, setExpandedConnectorId] = useState<string | null>(
    null,
  )
  const [advancedOpen, setAdvancedOpen] = useState(false)

  if (template !== appliedTemplate && open) {
    setAppliedTemplate(template)
    applyTemplate(template ?? null)
  }

  const activeAgents = agents.filter((agent) => !agent.archived_at)
  const submitting = createAutomation.isPending
  const selectedAgent = activeAgents.find((agent) => agent.id === assigneeId)
  const totalCapabilities =
    selectedConnectorIds.length + selectedToolNames.length

  const handleSubmit = async () => {
    if (!title.trim() || !assigneeId || submitting) return
    const requiredConnectors = selectedConnectorIds.filter(
      (
        connectorId,
      ): connectorId is
        | 'github'
        | 'exa-search'
        | 'slack'
        | 'gmail'
        | 'google-drive' =>
        ['github', 'exa-search', 'slack', 'gmail', 'google-drive'].includes(
          connectorId,
        ),
    )
    const templateCapabilities = selectedTemplate?.executionConfig?.capabilities
    const executionConfig = createAutomationExecutionConfig({
      templateId:
        selectedTemplate?.executionConfig?.templateId ?? 'custom-automation',
      templateVersion: selectedTemplate?.executionConfig?.templateVersion ?? 1,
      capabilities: {
        browser:
          templateCapabilities?.browser === true ||
          selectedToolNames.some((tool) => tool.startsWith('browser_')),
        sandbox:
          templateCapabilities?.sandbox === true ||
          selectedToolNames.some((tool) => tool.includes('sandbox')),
        github:
          templateCapabilities?.github === true ||
          selectedConnectorIds.includes('github'),
      },
      requiredSkills: selectedSkillSlugs,
      requiredConnectors,
      inputContract: selectedTemplate?.executionConfig?.runContract.input,
      outputContract: selectedTemplate?.executionConfig?.runContract.output,
    })
    const result = await Result.tryPromise(() =>
      createAutomation.mutateAsync({
        title: title.trim(),
        description: description.trim() || null,
        assignee_agent_id: assigneeId,
        priority: 'medium',
        system_prompt: selectedTemplate?.systemPrompt ?? null,
        execution_config: executionConfig,
        output_config: selectedTemplate?.outputConfig ?? null,
        category: selectedTemplate?.category ?? null,
        tags: selectedTemplate?.tags ?? [],
        template_source: selectedTemplate?.templateSource ?? null,
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
    resetDraft()
    setExpandedConnectorId(null)
    toast.success('Automation created')
    onCreated?.(result.value.automation)
  }

  const previewLine = (() => {
    const agentLabel = selectedAgent?.name ?? 'an agent'
    return `Runs ${describeTriggerShort(triggerConfig)} as ${agentLabel}.`
  })()

  const detailTemplate = selectedTemplate
    ? (TEMPLATES.find(
        (candidate) =>
          (candidate.templateSource &&
            candidate.templateSource === selectedTemplate.templateSource) ||
          candidate.title === selectedTemplate.title,
      ) ?? null)
    : null
  const detailPromptSource = detailTemplate?.prompt ?? selectedTemplate?.prompt
  const detailConnectors =
    detailTemplate?.executionConfig?.requiredConnectors ??
    selectedTemplate?.executionConfig?.requiredConnectors ??
    []
  const detailSkills =
    detailTemplate?.executionConfig?.requiredSkills ??
    selectedTemplate?.executionConfig?.requiredSkills ??
    []
  const detailTags = detailTemplate?.tags ?? selectedTemplate?.tags ?? []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          '!w-[min(94vw,35rem)] !max-w-[min(94vw,35rem)] sm:!max-w-[min(94vw,35rem)]',
          'flex max-h-[88vh] flex-col gap-0 overflow-hidden rounded-[18px] border-0 p-0',
          'bg-vellum-heavy shadow-[var(--shadow-float-2)] backdrop-blur-2xl',
        )}
      >
        <div className="border-b border-hairline px-5 pt-5 pb-3.5">
          <DialogTitle className="text-[15px] font-medium tracking-tight">
            New automation
          </DialogTitle>
          <p className="mt-1 line-clamp-1 text-[11.5px] text-muted-foreground">
            {previewLine}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pt-4 pb-5">
          <div className="space-y-5">
            <section>
              <SectionLabel>Template</SectionLabel>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                <TemplateRow
                  icon={Sparkles}
                  title="Custom"
                  selected={!selectedTemplate}
                  onClick={() => applyTemplate(null)}
                />
                {TEMPLATES.map((candidate) => (
                  <TemplateRow
                    key={candidate.templateSource ?? candidate.title}
                    icon={candidate.icon}
                    title={candidate.title}
                    selected={
                      (selectedTemplate?.templateSource &&
                        selectedTemplate.templateSource ===
                          candidate.templateSource) ||
                      selectedTemplate?.title === candidate.title
                    }
                    onClick={() => applyTemplate(candidate)}
                  />
                ))}
              </div>

              <TemplateDetail
                title={detailTemplate?.title ?? 'Custom'}
                summary={
                  detailTemplate?.summary ??
                  'Start blank. Write the prompt yourself and choose tools and skills under Advanced.'
                }
                promptPreview={detailPromptSource}
                frequency={detailTemplate?.frequency ?? triggerConfig.frequency}
                time={detailTemplate?.time ?? triggerConfig.time}
                connectors={detailConnectors}
                skills={detailSkills}
                tags={detailTags}
                category={detailTemplate?.category}
              />
            </section>

            <Field label="Name">
              <input
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="e.g. Daily code review"
                className={cn(
                  'h-9 w-full rounded-[6px] border border-hairline bg-bone px-3 text-sm outline-none transition-colors',
                  'focus:border-moss/60 focus:ring-2 focus:ring-moss/15',
                )}
                autoFocus
              />
            </Field>

            <Field label="Prompt">
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Step-by-step instructions for the agent…"
                rows={4}
                className={cn(
                  'w-full resize-y rounded-[6px] border border-hairline bg-bone px-3 py-2 text-sm leading-relaxed outline-none transition-colors',
                  'focus:border-moss/60 focus:ring-2 focus:ring-moss/15',
                )}
              />
            </Field>

            <Field label="Run as">
              <Select
                value={assigneeId}
                onValueChange={(value) => value && setAssigneeId(value)}
              >
                <SelectTrigger className="h-9 w-full rounded-[6px] border-hairline bg-bone transition-colors hover:border-foreground/20 focus:ring-2 focus:ring-moss/15">
                  <SelectValue placeholder="Select an agent">
                    {() =>
                      selectedAgent ? (
                        <span className="flex items-center gap-2">
                          <ActorAvatarBase
                            name={selectedAgent.name}
                            initials={agentInitials(selectedAgent.name)}
                            avatarUrl={selectedAgent.avatar_url}
                            isAgent
                            size={18}
                          />
                          <span className="truncate text-sm">
                            {selectedAgent.name}
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          Select an agent
                        </span>
                      )
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {activeAgents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      <span className="flex items-center gap-2">
                        <ActorAvatarBase
                          name={agent.name}
                          initials={agentInitials(agent.name)}
                          avatarUrl={agent.avatar_url}
                          isAgent
                          size={18}
                        />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-sm leading-tight">
                            {agent.name}
                          </span>
                          {agent.description ? (
                            <span className="truncate text-[11px] leading-tight text-muted-foreground">
                              {agent.description}
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Schedule">
              <TriggerConfigSection
                config={triggerConfig}
                onChange={setTriggerConfig}
              />
            </Field>

            <Collapsible
              open={advancedOpen}
              onOpenChange={setAdvancedOpen}
              className="-mx-1"
            >
              <CollapsibleTrigger
                className={cn(
                  'group/adv flex w-full items-center justify-between gap-2 rounded-full px-2 py-1.5 text-left transition-colors',
                  'hover:bg-parchment-deep/50',
                )}
              >
                <span className="flex items-baseline gap-2">
                  <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80">
                    Advanced options
                  </span>
                  <span className="text-[10.5px] text-muted-foreground/70">
                    {totalCapabilities} tools · {selectedSkillSlugs.length}{' '}
                    skills
                  </span>
                </span>
                <ChevronDown
                  className={cn(
                    'size-3.5 text-muted-foreground transition-transform duration-200',
                    advancedOpen && 'rotate-180',
                  )}
                />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-3 space-y-5 px-1">
                  <section>
                    <div className="flex items-baseline justify-between">
                      <SectionLabel>Tools</SectionLabel>
                      <span className="text-[10.5px] text-muted-foreground/80">
                        {totalCapabilities} selected
                      </span>
                    </div>
                    <div className="mt-2 divide-y divide-hairline-soft overflow-hidden rounded-[10px] border border-hairline bg-bone/70">
                      {liveConnectors.map((connector) => {
                        const expanded = expandedConnectorId === connector.slug
                        const selected = selectedConnectorIds.includes(
                          connector.slug,
                        )
                        return (
                          <div key={connector.slug}>
                            <div
                              className={cn(
                                'flex items-center gap-2.5 px-3 py-2 transition-colors',
                                selected && 'bg-moss/[0.05]',
                              )}
                            >
                              <Checkbox
                                checked={selected}
                                onCheckedChange={() =>
                                  toggleConnectorId(connector.slug)
                                }
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 text-[13px] font-medium">
                                  <span className="truncate">
                                    {connector.label}
                                  </span>
                                  <ConnectorStatusDot
                                    status={connector.status}
                                  />
                                </div>
                                <div className="truncate text-[11px] text-muted-foreground">
                                  {connector.description}
                                </div>
                              </div>
                              {connector.tools.length > 0 ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedConnectorId(
                                      expanded ? null : connector.slug,
                                    )
                                  }
                                  className="flex shrink-0 items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-hairline-soft transition-colors hover:bg-muted hover:text-foreground"
                                >
                                  {connector.tools.length} tools
                                  <ChevronDown
                                    className={cn(
                                      'size-3 transition-transform duration-200',
                                      expanded && 'rotate-180',
                                    )}
                                  />
                                </button>
                              ) : null}
                            </div>
                            {expanded && connector.tools.length > 0 ? (
                              <div className="space-y-px bg-parchment-deep/40 px-3 py-2">
                                {connector.tools.map((tool) => (
                                  <label
                                    key={`${connector.slug}:${tool.name}`}
                                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 transition-colors hover:bg-bone/70"
                                  >
                                    <Checkbox
                                      checked={selectedToolNames.includes(
                                        tool.name,
                                      )}
                                      onCheckedChange={() =>
                                        toggleToolName(tool.name)
                                      }
                                    />
                                    <span className="flex min-w-0 flex-1 items-center gap-2">
                                      <span className="truncate font-mono text-[11px]">
                                        {tool.name}
                                      </span>
                                    </span>
                                  </label>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        )
                      })}
                      {liveConnectors.length === 0 ? (
                        <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                          No connectors are connected yet. Connect one in
                          Settings to expose its tools here.
                        </div>
                      ) : null}
                    </div>
                  </section>

                  <section>
                    <div className="flex items-baseline justify-between">
                      <SectionLabel>Skills</SectionLabel>
                      <span className="text-[10.5px] text-muted-foreground/80">
                        {selectedSkillSlugs.length} selected
                      </span>
                    </div>
                    <div className="mt-2 max-h-44 space-y-px overflow-y-auto rounded-[10px] border border-hairline bg-bone/70">
                      {skills.length === 0 ? (
                        <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                          No skills configured
                        </div>
                      ) : (
                        skills.map((skill) => {
                          const slug = skillSlug(skill)
                          const checked = selectedSkillSlugs.includes(slug)
                          return (
                            <label
                              key={skill.id}
                              className={cn(
                                'flex cursor-pointer items-center gap-2.5 px-3 py-2 transition-colors',
                                checked
                                  ? 'bg-moss/[0.06]'
                                  : 'hover:bg-parchment-deep/40',
                              )}
                            >
                              <Checkbox
                                checked={checked}
                                onCheckedChange={() => toggleSkillSlug(slug)}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[13px] font-medium">
                                  {skill.name}
                                </span>
                                {skill.description ? (
                                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                                    {skill.description}
                                  </span>
                                ) : null}
                              </span>
                            </label>
                          )
                        })
                      )}
                    </div>
                  </section>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-hairline bg-parchment-deep/40 px-5 py-3">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="rounded-full"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!title.trim() || !assigneeId || submitting}
            className="rounded-full bg-moss text-parchment hover:bg-moss/90 active:scale-[0.98]"
          >
            {submitting ? 'Creating…' : 'Create automation'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80">
      {children}
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <SectionLabel>{label}</SectionLabel>
      {children}
    </div>
  )
}

function TemplateRow({
  icon: Icon,
  title,
  selected,
  onClick,
}: {
  icon: typeof Zap
  title: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group/row flex h-9 items-center gap-2 rounded-[10px] border px-2.5 text-left transition-all duration-150',
        'active:scale-[0.985]',
        selected
          ? 'border-moss/60 bg-moss/[0.08] text-foreground shadow-[var(--shadow-hairline-soft)]'
          : 'border-hairline bg-bone/55 hover:border-moss/30 hover:bg-bone',
      )}
      aria-pressed={selected}
    >
      <Icon
        className={cn(
          'size-3.5 shrink-0 transition-colors',
          selected
            ? 'text-moss'
            : 'text-muted-foreground group-hover/row:text-foreground',
        )}
        strokeWidth={1.75}
      />
      <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium tracking-tight">
        {title}
      </span>
      {selected ? (
        <span className="size-1.5 shrink-0 rounded-full bg-moss" />
      ) : null}
    </button>
  )
}

function TemplateDetail({
  title,
  summary,
  promptPreview,
  frequency,
  time,
  connectors,
  skills,
  tags,
  category,
}: {
  title: string
  summary: string
  promptPreview?: string
  frequency: TriggerFrequency
  time: string
  connectors: readonly string[]
  skills: readonly string[]
  tags: readonly string[]
  category?: string
}) {
  const cadence = (() => {
    switch (frequency) {
      case 'hourly':
        return 'Hourly'
      case 'daily':
        return `Daily · ${formatClock(time)}`
      case 'weekdays':
        return `Weekdays · ${formatClock(time)}`
      case 'weekly':
        return `Weekly · ${formatClock(time)}`
      case 'custom':
        return 'Custom cadence'
    }
  })()
  const hasChips =
    connectors.length > 0 ||
    skills.length > 0 ||
    tags.length > 0 ||
    Boolean(category)

  return (
    <div className="mt-3 overflow-hidden rounded-[12px] border border-hairline bg-bone/60 shadow-[var(--shadow-hairline-soft)]">
      <div className="flex items-baseline justify-between gap-3 px-3.5 pt-3 pb-2">
        <div className="min-w-0">
          <div className="text-[13px] font-medium tracking-tight">{title}</div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
            {summary}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-parchment-deep/70 px-2 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground ring-1 ring-hairline-soft">
          {cadence}
        </span>
      </div>

      {promptPreview ? (
        <div className="border-t border-hairline-soft bg-parchment-deep/30 px-3.5 py-2.5">
          <div className="mb-1 text-[9.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80">
            What it does
          </div>
          <pre className="whitespace-pre-wrap font-prose text-[11.5px] leading-snug text-foreground/85 [&::-webkit-scrollbar]:hidden">
            {clampLines(promptPreview, 5)}
          </pre>
        </div>
      ) : null}

      {hasChips ? (
        <div className="flex flex-wrap items-center gap-1 border-t border-hairline-soft px-3.5 py-2.5">
          {category ? <DetailChip tone="lichen">{category}</DetailChip> : null}
          {connectors.map((connector) => (
            <DetailChip key={`c:${connector}`} tone="moss">
              {connector}
            </DetailChip>
          ))}
          {skills.map((skill) => (
            <DetailChip key={`s:${skill}`} tone="sage">
              {skill}
            </DetailChip>
          ))}
          {tags.map((tag) => (
            <DetailChip key={`t:${tag}`} tone="stone">
              {tag}
            </DetailChip>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function DetailChip({
  children,
  tone,
}: {
  children: React.ReactNode
  tone: 'moss' | 'sage' | 'lichen' | 'stone'
}) {
  const toneClass =
    tone === 'moss'
      ? 'bg-moss/10 text-moss ring-moss/20'
      : tone === 'sage'
        ? 'bg-sage/15 text-foreground/80 ring-sage/25'
        : tone === 'lichen'
          ? 'bg-parchment-deep text-foreground/80 ring-hairline'
          : 'bg-muted/60 text-muted-foreground ring-hairline-soft'
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium tracking-tight ring-1',
        toneClass,
      )}
    >
      {children}
    </span>
  )
}

function clampLines(value: string, maxLines: number): string {
  const lines = value.split('\n')
  if (lines.length <= maxLines) return value
  return `${lines.slice(0, maxLines).join('\n')}…`
}

function ConnectorStatusDot({
  status,
}: {
  status:
    | 'available'
    | 'connected'
    | 'degraded'
    | 'disconnected'
    | 'setup_required'
}) {
  const tone =
    status === 'connected'
      ? 'bg-sage'
      : status === 'degraded'
        ? 'bg-amber'
        : status === 'disconnected'
          ? 'bg-stone'
          : 'bg-stone/60'
  return (
    <span
      className={cn(
        'inline-block size-1.5 shrink-0 rounded-full ring-2 ring-bone',
        tone,
      )}
      aria-label={status}
      title={status}
    />
  )
}

function agentInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

function describeTriggerShort(config: TriggerConfig): string {
  switch (config.frequency) {
    case 'hourly': {
      const min = parseInt(config.time.split(':')[1] ?? '0', 10)
      return `hourly at :${min.toString().padStart(2, '0')}`
    }
    case 'daily':
      return `daily at ${formatClock(config.time)}`
    case 'weekdays':
      return `weekdays at ${formatClock(config.time)}`
    case 'weekly': {
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      return `every ${days[config.dayOfWeek]} at ${formatClock(config.time)}`
    }
    case 'custom':
      return `on \`${config.cronExpression}\``
  }
}

function formatClock(time: string): string {
  const [h, m] = time.split(':')
  const hour = parseInt(h ?? '9', 10)
  const min = parseInt(m ?? '0', 10)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  return `${hour % 12 || 12}:${min.toString().padStart(2, '0')} ${ampm}`
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
                      {template.executionConfig ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {template.executionConfig.requiredConnectors.map(
                            (connector) => (
                              <span
                                key={connector}
                                className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                              >
                                {connector}
                              </span>
                            ),
                          )}
                          {template.executionConfig.requiredSkills
                            .slice(0, 2)
                            .map((skill) => (
                              <span
                                key={skill}
                                className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                              >
                                {skill}
                              </span>
                            ))}
                        </div>
                      ) : null}
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
