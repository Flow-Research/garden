import { createIssueViewStore } from '@garden/app-state/issues/stores/view-store'

/**
 * Team issue surfaces keep their own persisted view state so board/list mode,
 * sort, and collapsed groups do not leak into the workspace Issues page.
 */
export const teamIssueViewStore = createIssueViewStore('garden_team_issues_view')
