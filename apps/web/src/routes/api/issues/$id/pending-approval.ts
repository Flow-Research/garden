import { createFileRoute } from '@tanstack/react-router'
import { and, desc, eq } from 'drizzle-orm'
import { requireAppRequestContext } from '@/lib/server/context'
import type { AppRequestContext } from '@/lib/server/context'
import { json, requireWorkspaceContext } from '@/lib/server/control-plane'
import { schema } from '@/lib/server/db'

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

export const getIssuePendingApproval = async ({
  context,
  params,
}: {
  context: AppRequestContext
  params: { id: string }
}): Promise<Response> => {
  const appContext = requireAppRequestContext(context)
  const workspaceContext = await requireWorkspaceContext(appContext)
  if (workspaceContext instanceof Response) return workspaceContext

  const db = await appContext.db()
  const [issue] = await db
    .select({ activeRunId: schema.issue.activeRunId })
    .from(schema.issue)
    .where(
      and(
        eq(schema.issue.id, params.id),
        eq(schema.issue.workspaceId, workspaceContext.workspaceId),
      ),
    )
    .limit(1)

  const activeRunId = issue?.activeRunId
  if (activeRunId === null || activeRunId === undefined) {
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
