import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { postIssueComment } from '@garden/server/issues/server'
import { appEnv } from '@/lib/server/env'
import {
  commentBodySchema,
  parseJsonBody,
} from '@/lib/server/validation/issues'
import { badRequest } from '@/lib/server/control-plane'
import { requireIssueAccess } from '@/lib/server/issue-access'
import { publishWorkspaceEvent } from '@/lib/server/realtime'
import { listIssueComments } from '@/lib/server/issues/comments-service'
import { archiveIssueInboxItemsByKey } from '@/lib/server/queries/issues'
import { serviceErrorResponse } from '@/lib/server/service-error-response'

export const Route = createFileRoute('/api/issues/$id/comments')({
  server: {
    handlers: {
      GET: async ({ context, params }) => {
        const appContext = requireAppRequestContext(context)
        const access = await requireIssueAccess(appContext, params.id)
        if (access instanceof Response) return access

        const commentsResult = await listIssueComments(access.db, params.id)
        return commentsResult.match({
          ok: (comments) => Response.json(comments),
          err: (error) => serviceErrorResponse(error),
        })
      },
      POST: async ({ context, request, params }) => {
        const appContext = requireAppRequestContext(context)
        const bodyResult = await parseJsonBody(
          request,
          commentBodySchema,
          'Comment content is required',
        )
        if (bodyResult.isErr()) return badRequest(bodyResult.error.message)
        const body = bodyResult.value

        const access = await requireIssueAccess(appContext, params.id)
        if (access instanceof Response) return access
        const db = access.db
        const existingIssue = access.issue

        const commentResult = await postIssueComment({
          databaseUrl: appEnv.HYPERDRIVE.connectionString,
          workspaceId: existingIssue.workspaceId,
          issueIdOrIdentifier: params.id,
          authorUserId: access.session.user.id,
          body: body.content,
          parentId: body.parent_id ?? null,
          attachmentIds: body.attachment_ids,
          issueRunEnv: appEnv,
        })
        if (commentResult.isErr())
          return badRequest(commentResult.error.message)
        if (existingIssue.activeRunId) {
          await archiveIssueInboxItemsByKey(db, {
            workspaceId: existingIssue.workspaceId,
            itemKeys: [`waiting_for_input:${existingIssue.activeRunId}`],
          })
        }

        appContext.waitUntil(
          publishWorkspaceEvent(appContext.env, existingIssue.workspaceId, {
            type: 'comment:created',
            payload: {
              issue_id: existingIssue.id,
              comment_id: commentResult.value.comment.id,
              team_id: existingIssue.teamId,
            },
          }),
        )
        return Response.json(commentResult.value.comment, { status: 201 })
      },
    },
  },
})
