import type { Issue, IssuePriority, IssueStatus } from '@garden/core/types'
import type { ActorFilterValue } from '@garden/app-state/issues/stores/view-store'

/** Matches every normalized query term against visible issue copy. */
export function matchesIssueSearch(issue: Issue, query: string): boolean {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return true
  const haystack = [issue.identifier, issue.title, issue.description]
    .filter(Boolean)
    .join('\n')
    .toLocaleLowerCase()
  return terms.every((term) => haystack.includes(term))
}

export interface IssueFilters {
  statusFilters: IssueStatus[]
  priorityFilters: IssuePriority[]
  assigneeFilters: ActorFilterValue[]
  includeNoAssignee: boolean
  creatorFilters: ActorFilterValue[]
  projectFilters: string[]
  includeNoProject: boolean
}

function actorMatches(
  type: string | null,
  id: string | null,
  selected: ActorFilterValue[],
  includeEmpty: boolean,
): boolean {
  if (!selected.length && !includeEmpty) return true
  if (!id) return includeEmpty
  return selected.some((actor) => actor.type === type && actor.id === id)
}

function projectMatches(
  projectId: string | null,
  selected: string[],
  includeEmpty: boolean,
): boolean {
  if (!selected.length && !includeEmpty) return true
  return projectId ? selected.includes(projectId) : includeEmpty
}

/** Applies independent positive-selection predicates to the cached issue collection. */
export function filterIssues(issues: Issue[], filters: IssueFilters): Issue[] {
  return issues.filter(
    (issue) =>
      (!filters.statusFilters.length ||
        filters.statusFilters.includes(issue.status)) &&
      (!filters.priorityFilters.length ||
        filters.priorityFilters.includes(issue.priority)) &&
      actorMatches(
        issue.assignee_type,
        issue.assignee_id,
        filters.assigneeFilters,
        filters.includeNoAssignee,
      ) &&
      actorMatches(
        issue.creator_type,
        issue.creator_id,
        filters.creatorFilters,
        false,
      ) &&
      projectMatches(
        issue.project_id,
        filters.projectFilters,
        filters.includeNoProject,
      ),
  )
}
