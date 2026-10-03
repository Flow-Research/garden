import { useQuery } from '@tanstack/react-query'
import { FolderKanban, UserMinus } from 'lucide-react'
import { useWorkspaceId } from '@garden/app-state/hooks'
import type {
  ActorFilterValue,
  IssueViewState,
} from '@garden/app-state/issues/stores/view-store'
import {
  ALL_STATUSES,
  PRIORITY_CONFIG,
  PRIORITY_ORDER,
  STATUS_CONFIG,
} from '@garden/core/issues/config'
import type { Issue } from '@garden/core/types'
import { Button } from '@garden/ui/components/ui/button'
import { cn } from '@garden/ui/lib/utils'
import { projectListOptions } from '@/lib/projects/queries'
import { agentListOptions, memberListOptions } from '@/lib/workspace/queries'
import { ActorAvatar } from '../../common/actor-avatar'
import { PriorityIcon, StatusIcon } from '.'

export type IssueCounts = {
  actors: Map<string, number>
  noAssignee: number
  noProject: number
  priorities: Map<string, number>
  projects: Map<string, number>
  statuses: Map<string, number>
}

export type IssueFilterState = Pick<
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
export function countIssues(issues: Issue[]): IssueCounts {
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

export function numberOfActiveFilters(state: IssueFilterState): number {
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

/**
 * Garden-specific filter tray replacing the inherited nested-menu structure.
 * Shared by the workspace Issues header and the Team detail tab toolbar, which
 * supplies its own Popover trigger and view-store state.
 */
export function IssueFilterTray({
  actions,
  counts,
  state,
}: {
  actions: IssueViewState
  counts: IssueCounts
  state: IssueFilterState
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
