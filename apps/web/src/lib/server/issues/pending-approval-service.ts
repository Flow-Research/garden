import { Result, type Result as ResultValue } from 'better-result'
import { IssueServiceError } from '@garden/server/issues/server'
import type { Db } from '@/lib/server/db'
import { loadPendingApprovalRequestForRun } from '@/lib/server/queries/issues'

const PREVIEW_TEXT_KEYS = ['body', 'message', 'content', 'text', 'comment']

function previewText(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  for (const key of PREVIEW_TEXT_KEYS) {
    const candidate = record[key]
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate
    }
  }
  return null
}

function previewTarget(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined
  const record = value as Record<string, unknown>
  const owner = record.owner
  const repo = record.repo
  const issueNumber = record.issue_number
  if (
    typeof owner === 'string' &&
    typeof repo === 'string' &&
    (typeof issueNumber === 'number' || typeof issueNumber === 'string')
  ) {
    return `github.com/${owner}/${repo}#${issueNumber}`
  }
  return undefined
}

export type IssuePendingApproval = {
  approval: {
    request_id: string
    title: string
    body: string
    targetLabel?: string
  } | null
}

/**
 * Maps the newest pending permission request on an issue run into the approval
 * preview JSON the issue UI expects.
 *
 * Before: preview mapping lived inline in the route next to Drizzle. After:
 * route owns Team access via `requireIssueAccess` and passes `activeRunId`;
 * this service owns query + mapping so the route stays drizzle-free.
 */
export async function getIssuePendingApproval(
  db: Db,
  input: { activeRunId: string | null },
): Promise<ResultValue<IssuePendingApproval, IssueServiceError>> {
  const activeRunId = input.activeRunId
  if (activeRunId === null) {
    return Result.ok({ approval: null })
  }

  return await Result.tryPromise({
    try: async () => {
      const request = await loadPendingApprovalRequestForRun(db, activeRunId)
      if (request === null) return { approval: null }

      const targetLabel = previewTarget(request.argsJson)
      return {
        approval: {
          request_id: request.id,
          title: request.context ?? 'Approval needed',
          body: previewText(request.argsJson) ?? request.context ?? '',
          ...(targetLabel ? { targetLabel } : {}),
        },
      }
    },
    catch: (cause) =>
      new IssueServiceError({
        code: 'db_error',
        message: 'load pending approval failed',
        cause,
      }),
  })
}
