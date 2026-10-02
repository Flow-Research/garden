import { and, eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { z } from 'zod'
import { parseJsonBody } from '@/lib/server/validation/chat'
import {
  badRequest,
  forbidden,
  notFound,
  toChatThread,
} from '@/lib/server/control-plane'
import { schema } from '@/lib/server/db'
import { getThreadAccess } from '@/lib/server/chat-threads'
import { requireIssueAccess } from '@/lib/server/issue-access'

const primaryIssueBodySchema = z
  .object({
    issue_id: z.string().uuid().nullable(),
  })
  .strict()

export const Route = createFileRoute('/api/chat/threads/$id/primary-issue')({
  server: {
    handlers: {
      POST: async ({ context, request, params }) => {
        const appContext = requireAppRequestContext(context)
        const access = await getThreadAccess(appContext, params.id)
        if (access instanceof Response) return access

        const bodyResult = await parseJsonBody(
          request,
          primaryIssueBodySchema,
          'Invalid primary issue payload',
        )
        if (bodyResult.isErr()) return badRequest(bodyResult.error.message)
        const body = bodyResult.value

        let primaryIssue: {
          id: string
          number: number
          title: string
          status: string | null
        } | null = null

        if (body.issue_id) {
          const issueAccess = await requireIssueAccess(
            appContext,
            body.issue_id,
          )
          if (issueAccess instanceof Response) return issueAccess
          const issue = issueAccess.issue
          if (issue.workspaceId !== access.thread.workspaceId) {
            return forbidden('Issue access denied')
          }
          primaryIssue = {
            id: issue.id,
            number: issue.number,
            title: issue.title,
            status: issue.status,
          }
        }

        const [thread] = await access.db
          .update(schema.chatThread)
          .set({
            primaryIssueId: body.issue_id,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.chatThread.id, params.id),
              eq(schema.chatThread.workspaceId, access.thread.workspaceId),
              eq(schema.chatThread.ownerUserId, access.session.user.id),
            ),
          )
          .returning()

        if (!thread) return notFound('Chat thread not found')
        return Response.json(
          toChatThread(thread, access.hostName, primaryIssue),
        )
      },
    },
  },
})
