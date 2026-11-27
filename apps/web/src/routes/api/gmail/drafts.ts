import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import {
  badRequest,
  json,
  requireWorkspaceContext,
} from '@/lib/server/control-plane'
import { runExecutorRouteEffect } from '@/lib/server/executor-observability'
import { listGmail, saveGmailDraft } from '@/lib/server/gmail-service'
import {
  parseJsonBody,
  parseSearchParams,
} from '@/lib/server/validation/common'
import {
  gmailComposeBodySchema,
  gmailDraftsQuerySchema,
} from '@/lib/server/validation/gmail'

export const Route = createFileRoute('/api/gmail/drafts')({
  server: {
    handlers: {
      GET: async ({ context, request }) => {
        const appContext = requireAppRequestContext(context)
        const workspaceContext = await requireWorkspaceContext(appContext)
        if (workspaceContext instanceof Response) return workspaceContext

        const query = parseSearchParams(
          request,
          gmailDraftsQuerySchema,
          'Invalid drafts query',
        )
        if (query.isErr()) return badRequest(query.error.message)

        const outcome = await runExecutorRouteEffect({
          effect: listGmail(
            {
              tenant: workspaceContext.workspaceId,
              subject: workspaceContext.session.user.id,
            },
            'drafts',
            query.value.cursor,
          ),
          request,
          event: 'gmail.drafts.list.failed',
          tenant: workspaceContext.workspaceId,
          subject: workspaceContext.session.user.id,
          fallbackMessage: 'Could not load Gmail drafts.',
        })
        if (!outcome.ok) return outcome.response
        return json(outcome.value)
      },
      POST: async ({ context, request }) => {
        const appContext = requireAppRequestContext(context)
        const workspaceContext = await requireWorkspaceContext(appContext)
        if (workspaceContext instanceof Response) return workspaceContext

        const body = await parseJsonBody(
          request,
          gmailComposeBodySchema,
          'Invalid draft',
        )
        if (body.isErr()) return badRequest(body.error.message)

        const outcome = await runExecutorRouteEffect({
          effect: saveGmailDraft(
            {
              tenant: workspaceContext.workspaceId,
              subject: workspaceContext.session.user.id,
            },
            body.value,
          ),
          request,
          event: 'gmail.drafts.save.failed',
          tenant: workspaceContext.workspaceId,
          subject: workspaceContext.session.user.id,
          fallbackMessage: 'Could not save the Gmail draft.',
        })
        if (!outcome.ok) return outcome.response
        return json(outcome.value)
      },
    },
  },
})
