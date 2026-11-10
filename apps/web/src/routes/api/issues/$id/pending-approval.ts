import { createFileRoute } from '@tanstack/react-router'
import { and, desc, eq } from 'drizzle-orm'
import { requireAppRequestContext } from '@/lib/server/context'
import type { AppRequestContext } from '@/lib/server/context'
import { json } from '@/lib/server/control-plane'
import { schema } from '@/lib/server/db'
import { requireIssueAccess } from '@/lib/server/issue-access'

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

/**
 * Returns the newest pending approval preview for an issue's active run.
 *
 * Before (#297): only `requireWorkspaceContext` ran, so any workspace member
 * could read a Team issue's approval preview. After: uses the same
 * `requireIssueAccess` Team visibility check as the other issue subresources
 * (see `@/lib/server/issue-access.ts`).
 */
export const getIssuePendingApproval = async ({
  context,
  params,
}: {
  context: AppRequestContext
  params: { id: string }
}): Promise<Response> => {
  const appContext = requireAppRequestContext(context)
  const access = await requireIssueAccess(appContext, params.id)
  if (access instanceof Response) return access

  const db = access.db
  const activeRunId = access.issue.activeRunId
  if (activeRunId === null) {
    return json({ approval: null })
  }

  const [request] = await db
    .select({
      id: schema.permissionRequest.id,
      context: schema.permissionRequest.context,
      kind: schema.permissionRequest.kind,
      argsJson: schema.permissionRequest.argsJson,
    })
    .from(schema.permissionRequest)
    .where(
      and(
        eq(schema.permissionRequest.runId, activeRunId),
        eq(schema.permissionRequest.status, 'pending'),
      ),
    )
    .orderBy(desc(schema.permissionRequest.requestedAt))
    .limit(1)

  if (request === undefined) {
    return json({ approval: null })
  }

  const targetLabel = previewTarget(request.argsJson)
  return json({
    approval: {
      request_id: request.id,
      title: request.context ?? 'Approval needed',
      body: previewText(request.argsJson) ?? request.context ?? '',
      ...(targetLabel ? { targetLabel } : {}),
    },
  })
}

export const Route = createFileRoute('/api/issues/$id/pending-approval')({
  server: {
    handlers: {
      GET: getIssuePendingApproval,
    },
  },
})
