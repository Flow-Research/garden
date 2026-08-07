import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowUp,
  Columns3,
  Filter,
  FolderKanban,
  List,
  Plus,
  Search,
  SlidersHorizontal,
  UserMinus,
  X,
} from 'lucide-react'
import { useWorkspaceId } from '@garden/app-state/hooks'
import type {
  ActorFilterValue,
  IssueViewState,
  SortField,
} from '@garden/app-state/issues/stores/view-store'
import {
  CARD_PROPERTY_OPTIONS,
  SORT_OPTIONS,
} from '@garden/app-state/issues/stores/view-store'
import type { IssuesScope } from '@garden/app-state/issues/stores/issues-scope-store'
import {
  ALL_STATUSES,
  PRIORITY_CONFIG,
  PRIORITY_ORDER,
  STATUS_CONFIG,
} from '@garden/core/issues/config'
import type { Issue } from '@garden/core/types'
import { Button } from '@garden/ui/components/ui/button'
import { Input } from '@garden/ui/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@garden/ui/components/ui/popover'
import { Separator } from '@garden/ui/components/ui/separator'
import { Switch } from '@garden/ui/components/ui/switch'
import { cn } from '@garden/ui/lib/utils'
import { agentListOptions, memberListOptions } from '@/lib/workspace/queries'
import { projectListOptions } from '@/lib/projects/queries'
import { ActorAvatar } from '../../common/actor-avatar'
import { PriorityIcon, StatusIcon } from '.'
import { useIssuesHeaderViewState } from '../hooks/use-issues-view-state'

const SCOPE_OPTIONS: readonly {
  description: string
  label: string
  value: IssuesScope
}[] = [
  { description: 'Every issue', label: 'All', value: 'all' },
  { description: 'Assigned to people', label: 'Members', value: 'members' },
  { description: 'Assigned to agents', label: 'Agents', value: 'agents' },
]

type IssueCounts = {
  actors: Map<string, number>
  noAssignee: number
  noProject: number
  priorities: Map<string, number>
  projects: Map<string, number>
  statuses: Map<string, number>
}

type FilterState = Pick<
  IssueViewState,
  | 'assigneeFilters'
  | 'creatorFilters'
  | 'includeNoAssignee'
  | 'includeNoProject'
  | 'priorityFilters'
  | 'projectFilters'
  | 'statusFilters'
>

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1)
}

/** Projects the current issue set into counts used by filter choices. */
function countIssues(issues: Issue[]): IssueCounts {
  const counts: IssueCounts = {
    actors: new Map(),
    noAssignee: 0,
    noProject: 0,
    priorities: new Map(),
    projects: new Map(),
    statuses: new Map(),
  }

  for (const issue of issues) {
    increment(counts.statuses, issue.status)
    increment(counts.priorities, issue.priority)
    increment(counts.actors, `${issue.creator_type}:${issue.creator_id}`)
    if (issue.assignee_id) {
      increment(counts.actors, `${issue.assignee_type}:${issue.assignee_id}`)
    } else {
      counts.noAssignee += 1
    }
    if (issue.project_id) {
      increment(counts.projects, issue.project_id)
    } else {
      counts.noProject += 1
    }
  }
  return counts
}

function actorIsSelected(
  filters: ActorFilterValue[],
  actor: ActorFilterValue,
): boolean {
  return filters.some(
    (candidate) => candidate.id === actor.id && candidate.type === actor.type,
  )
}

function numberOfActiveFilters(state: FilterState): number {
  return [
    state.statusFilters.length > 0,
    state.priorityFilters.length > 0,
    state.assigneeFilters.length > 0 || state.includeNoAssignee,
    state.creatorFilters.length > 0,
    state.projectFilters.length > 0 || state.includeNoProject,
  ].filter(Boolean).length
}

function FilterSection({
  children,
  label,
}: {
  children: React.ReactNode
  label: string
}) {
  return (
    <section className="space-y-2" aria-label={`${label} filters`}>
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </section>
  )
}

/** One filter token with count and explicit pressed state. */
function FilterChoice({
  children,
  count,
  onClick,
  selected,
}: {
  children: React.ReactNode
  count?: number
  onClick: () => void
  selected: boolean
}) {
  return (
    <Button
      aria-pressed={selected}
      className={cn(
        'h-7 gap-1.5 rounded-full px-2.5 text-xs font-normal',
        selected && 'border-primary/40 bg-primary/10 text-foreground',
      )}
      onClick={onClick}
      size="sm"
      type="button"
      variant="outline"
    >
      {children}
      {count ? <span className="text-muted-foreground">{count}</span> : null}
    </Button>
  )
}

/** Garden-specific filter tray replacing the inherited nested-menu structure. */
function IssueFilterTray({
  actions,
  counts,
  state,
}: {
  actions: IssueViewState
  counts: IssueCounts
  state: FilterState
}) {
  const workspaceId = useWorkspaceId()
  const { data: members = [] } = useQuery(memberListOptions(workspaceId))
  const { data: agents = [] } = useQuery(agentListOptions(workspaceId))
  const { data: projects = [] } = useQuery(projectListOptions(workspaceId))
  const hasFilters = numberOfActiveFilters(state) > 0

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Narrow this view</p>
          <p className="text-xs text-muted-foreground">
            Choices combine across groups
          </p>
        </div>
        {hasFilters ? (
          <Button onClick={actions.clearFilters} size="sm" variant="ghost">
            Clear all
          </Button>
        ) : null}
      </div>

      <FilterSection label="Status">
        {ALL_STATUSES.map((status) => (
          <FilterChoice
            count={counts.statuses.get(status)}
            key={status}
            onClick={() => actions.toggleStatusFilter(status)}
            selected={state.statusFilters.includes(status)}
          >
            <StatusIcon className="size-3.5" status={status} />
            {STATUS_CONFIG[status].label}
          </FilterChoice>
        ))}
      </FilterSection>

      <FilterSection label="Priority">
        {PRIORITY_ORDER.map((priority) => (
          <FilterChoice
            count={counts.priorities.get(priority)}
            key={priority}
            onClick={() => actions.togglePriorityFilter(priority)}
            selected={state.priorityFilters.includes(priority)}
          >
            <PriorityIcon priority={priority} />
            {PRIORITY_CONFIG[priority].label}
          </FilterChoice>
        ))}
      </FilterSection>

      <FilterSection label="Assignee">
        <FilterChoice
          count={counts.noAssignee}
          onClick={actions.toggleNoAssignee}
          selected={state.includeNoAssignee}
        >
          <UserMinus className="size-3.5" />
          Unassigned
        </FilterChoice>
        {members.map((member) => {
          const actor = { id: member.user_id, type: 'member' as const }
          return (
            <FilterChoice
              count={counts.actors.get(`member:${member.user_id}`)}
              key={member.user_id}
              onClick={() => actions.toggleAssigneeFilter(actor)}
              selected={actorIsSelected(state.assigneeFilters, actor)}
            >
              <ActorAvatar
                actorId={member.user_id}
                actorType="member"
                size={16}
              />
              {member.name}
            </FilterChoice>
          )
        })}
        {agents
          .filter((agent) => !agent.archived_at)
          .map((agent) => {
            const actor = { id: agent.id, type: 'agent' as const }
            return (
              <FilterChoice
                count={counts.actors.get(`agent:${agent.id}`)}
                key={agent.id}
                onClick={() => actions.toggleAssigneeFilter(actor)}
                selected={actorIsSelected(state.assigneeFilters, actor)}
              >
                <ActorAvatar actorId={agent.id} actorType="agent" size={16} />
                {agent.name}
              </FilterChoice>
            )
          })}
      </FilterSection>

      <FilterSection label="Creator">
        {members.map((member) => {
          const actor = { id: member.user_id, type: 'member' as const }
          return (
            <FilterChoice
              count={counts.actors.get(`member:${member.user_id}`)}
              key={member.user_id}
              onClick={() => actions.toggleCreatorFilter(actor)}
              selected={actorIsSelected(state.creatorFilters, actor)}
            >
              <ActorAvatar
                actorId={member.user_id}
                actorType="member"
                size={16}
              />
              {member.name}
            </FilterChoice>
          )
        })}
        {agents
          .filter((agent) => !agent.archived_at)
          .map((agent) => {
            const actor = { id: agent.id, type: 'agent' as const }
            return (
              <FilterChoice
                count={counts.actors.get(`agent:${agent.id}`)}
                key={agent.id}
                onClick={() => actions.toggleCreatorFilter(actor)}
                selected={actorIsSelected(state.creatorFilters, actor)}
              >
                <ActorAvatar actorId={agent.id} actorType="agent" size={16} />
                {agent.name}
              </FilterChoice>
            )
          })}
      </FilterSection>

      <FilterSection label="Project">
        <FilterChoice
          count={counts.noProject}
          onClick={actions.toggleNoProject}
          selected={state.includeNoProject}
        >
          No project
        </FilterChoice>
        {projects.map((project) => (
          <FilterChoice
            count={counts.projects.get(project.id)}
            key={project.id}
            onClick={() => actions.toggleProjectFilter(project.id)}
            selected={state.projectFilters.includes(project.id)}
          >
            {project.icon || <FolderKanban className="size-3.5" />}
            {project.title}
          </FilterChoice>
        ))}
      </FilterSection>
    </div>
  )
}

function DisplaySettings({
  actions,
  state,
}: {
  actions: IssueViewState
  state: Pick<IssueViewState, 'cardProperties' | 'sortBy' | 'sortDirection'>
}) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium">Display</p>
        <p className="text-xs text-muted-foreground">
          Ordering and card detail
        </p>
      </div>
      <label className="block space-y-1.5 text-xs text-muted-foreground">
        Order by
        <div className="flex gap-2">
          <select
            className="h-8 flex-1 rounded-md border bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onChange={(event) =>
              actions.setSortBy(event.currentTarget.value as SortField)
            }
            value={state.sortBy}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <Button
            aria-label={
              state.sortDirection === 'asc'
                ? 'Sort ascending'
                : 'Sort descending'
            }
            onClick={() =>
              actions.setSortDirection(
                state.sortDirection === 'asc' ? 'desc' : 'asc',
              )
            }
            size="icon-sm"
            variant="outline"
          >
            {state.sortDirection === 'asc' ? (
              <ArrowUp className="size-3.5" />
            ) : (
              <ArrowDown className="size-3.5" />
            )}
          </Button>
        </div>
      </label>
      <Separator />
      <div className="space-y-2.5">
        {CARD_PROPERTY_OPTIONS.map((property) => (
          <label
            className="flex cursor-pointer items-center justify-between text-sm"
            key={property.key}
          >
            {property.label}
            <Switch
              checked={state.cardProperties[property.key]}
              onCheckedChange={() => actions.toggleCardProperty(property.key)}
              size="sm"
            />
          </label>
        ))}
      </div>
    </div>
  )
}

/** Issues toolbar with compact scopes, search, and Garden-owned popover trays. */
export function IssuesHeader({
  onCreateIssue,
  onSearchQueryChange,
  scopedIssues,
  searchQuery,
}: {
  onCreateIssue: (data?: Record<string, unknown> | null) => void
  onSearchQueryChange: (query: string) => void
  scopedIssues: Issue[]
  searchQuery: string
}) {
  const view = useIssuesHeaderViewState()
  const counts = useMemo(() => countIssues(scopedIssues), [scopedIssues])
  const filterCount = numberOfActiveFilters(view)

  return (
    <header className="flex min-h-12 shrink-0 items-center gap-2 border-b px-4 py-2">
      <div
        aria-label="Issue scope"
        className="flex rounded-lg border bg-muted/30 p-0.5"
        role="group"
      >
        {SCOPE_OPTIONS.map((option) => (
          <Button
            aria-label={`${option.label}: ${option.description}`}
            aria-pressed={view.scope === option.value}
            className={cn(
              'h-7 border-0 px-2.5 text-xs shadow-none',
              view.scope === option.value
                ? 'bg-background text-foreground shadow-sm'
                : 'bg-transparent text-muted-foreground hover:bg-background/60',
            )}
            key={option.value}
            onClick={() => view.setScope(option.value)}
            size="sm"
            variant="outline"
          >
            {option.label}
          </Button>
        ))}
      </div>

      <div className="relative min-w-36 max-w-md flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Search issues"
          className="h-8 bg-background pl-8 pr-8 shadow-none"
          onChange={(event) => onSearchQueryChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onSearchQueryChange('')
          }}
          placeholder="Search issues"
          value={searchQuery}
        />
        {searchQuery ? (
          <Button
            aria-label="Clear issue search"
            className="absolute right-1 top-1/2 size-6 -translate-y-1/2"
            onClick={() => onSearchQueryChange('')}
            size="icon-sm"
            variant="ghost"
          >
            <X className="size-3" />
          </Button>
        ) : null}
      </div>

      <Button className="gap-1.5" onClick={() => onCreateIssue()} size="sm">
        <Plus className="size-3.5" />
        <span className="hidden sm:inline">New issue</span>
      </Button>

      <Popover>
        <PopoverTrigger
          render={
            <Button
              aria-label="Filters"
              className="relative gap-1.5"
              size="sm"
              variant="outline"
            >
              <Filter className="size-3.5" />
              <span className="hidden lg:inline">Filters</span>
              {filterCount ? (
                <span className="flex size-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
                  {filterCount}
                </span>
              ) : null}
            </Button>
          }
        />
        <PopoverContent
          align="end"
          className="max-h-[min(70vh,38rem)] w-[min(34rem,calc(100vw-2rem))] overflow-y-auto p-4"
        >
          <IssueFilterTray
            actions={view.actions}
            counts={counts}
            state={view}
          />
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger
          render={
            <Button
              aria-label="Display settings"
              size="icon-sm"
              variant="outline"
            >
              <SlidersHorizontal className="size-3.5" />
            </Button>
          }
        />
        <PopoverContent align="end" className="w-64 p-4">
          <DisplaySettings actions={view.actions} state={view} />
        </PopoverContent>
      </Popover>

      <Button
        aria-label={
          view.viewMode === 'board'
            ? 'Switch to list view'
            : 'Switch to board view'
        }
        onClick={() =>
          view.actions.setViewMode(view.viewMode === 'board' ? 'list' : 'board')
        }
        size="icon-sm"
        variant="outline"
      >
        {view.viewMode === 'board' ? (
          <Columns3 className="size-3.5" />
        ) : (
          <List className="size-3.5" />
        )}
      </Button>
    </header>
  )
}
