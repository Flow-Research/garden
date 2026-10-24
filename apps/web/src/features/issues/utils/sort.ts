import type { Issue } from '@garden/core/types'
import { PRIORITY_ORDER } from '@garden/core/issues/config'
import { compareOrderKeys } from '@garden/core/issues/order-key'
import type {
  SortField,
  SortDirection,
} from '@garden/app-state/issues/stores/view-store'

const PRIORITY_RANK: Record<string, number> = Object.fromEntries(
  PRIORITY_ORDER.map((p, i) => [p, i]),
)

export function sortIssues(
  issues: Issue[],
  field: SortField,
  direction: SortDirection,
): Issue[] {
  const sorted = [...issues].sort((a, b) => {
    switch (field) {
      case 'priority':
        return (
          (PRIORITY_RANK[a.priority] ?? 99) - (PRIORITY_RANK[b.priority] ?? 99)
        )
      case 'due_date': {
        if (!a.due_date && !b.due_date) return 0
        if (!a.due_date) return 1
        if (!b.due_date) return -1
        return new Date(a.due_date).getTime() - new Date(b.due_date).getTime()
      }
      case 'created_at':
        return (
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        )
      case 'title':
        return a.title.localeCompare(b.title)
      case 'position':
      default:
        // Code-unit order, as the database stores it; id breaks the rare
        // tie (two clients dropping into the same gap at once).
        return (
          compareOrderKeys(a.position, b.position) ||
          compareOrderKeys(a.id, b.id)
        )
    }
  })
  return direction === 'desc' ? sorted.reverse() : sorted
}
