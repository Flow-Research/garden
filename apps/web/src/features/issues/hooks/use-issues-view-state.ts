import { useShallow } from 'zustand/react/shallow'
import { useIssuesScopeStore } from '@garden/app-state/issues/stores/issues-scope-store'
import {
  type IssueViewState,
  useIssueViewStore,
} from '@garden/app-state/issues/stores/view-store'
import {
  useViewStore,
  useViewStoreApi,
} from '@garden/app-state/issues/stores/view-store-context'

type ScopeStoreState = {
  scope: 'all' | 'members' | 'agents'
  setScope: (scope: 'all' | 'members' | 'agents') => void
}

const scopeSelector = (state: ScopeStoreState) => ({
  scope: state.scope,
  setScope: state.setScope,
})

const pageViewSelector = (state: ReturnType<typeof useIssueViewStore.getState>) => ({
  viewMode: state.viewMode,
  statusFilters: state.statusFilters,
  priorityFilters: state.priorityFilters,
  assigneeFilters: state.assigneeFilters,
  includeNoAssignee: state.includeNoAssignee,
  creatorFilters: state.creatorFilters,
  projectFilters: state.projectFilters,
  includeNoProject: state.includeNoProject,
})

const headerViewSelector = (state: IssueViewState) => ({
  viewMode: state.viewMode,
  statusFilters: state.statusFilters,
  priorityFilters: state.priorityFilters,
  assigneeFilters: state.assigneeFilters,
  includeNoAssignee: state.includeNoAssignee,
  creatorFilters: state.creatorFilters,
  projectFilters: state.projectFilters,
  includeNoProject: state.includeNoProject,
  sortBy: state.sortBy,
  sortDirection: state.sortDirection,
  cardProperties: state.cardProperties,
})

export function useIssuesPageViewState() {
  const scopeState = useIssuesScopeStore(useShallow(scopeSelector))
  const viewState = useIssueViewStore(useShallow(pageViewSelector))

  return {
    ...scopeState,
    ...viewState,
  }
}

export function useIssuesHeaderViewState() {
  const scopeState = useIssuesScopeStore(useShallow(scopeSelector))
  const viewState = useViewStore(useShallow(headerViewSelector))
  const actions = useViewStoreApi().getState()

  return {
    ...scopeState,
    ...viewState,
    actions,
  }
}
