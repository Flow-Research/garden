import { inArray, type SQL } from 'drizzle-orm'
import { OPEN_STATUSES } from '@garden/core/issues/config'
import { schema } from '@/lib/server/db'

/**
 * WHERE condition for the issue list `open_only` filter.
 * Before: the route used `status <> 'done'`, so the Issues page "open" filter
 * returned cancelled issues. After: it matches the shared `OPEN_STATUSES` set
 * (todo, in_progress, in_review, blocked) from `@garden/core/issues/config`,
 * the same set Home's dashboard count uses via `isOpenIssueStatus`.
 */
export function openIssuesCondition(): SQL {
  return inArray(schema.issue.status, [...OPEN_STATUSES])
}
