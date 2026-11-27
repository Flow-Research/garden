import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import {
  badRequest,
  json,
  requireWorkspaceContext,
} from '@/lib/server/control-plane'
import { runExecutorRouteEffect } from '@/lib/server/executor-observability'
import { getGmailMessage, listGmail } from '@/lib/server/gmail-service'
import { parseSearchParams } from '@/lib/server/validation/common'
import { gmailSentQuerySchema } from '@/lib/server/validation/gmail'

export const Route = createFileRoute('/api/gmail/messages')({
  server: {
    handlers: {
      GET: async ({ context, request }) => {
        const appContext = requireAppRequestContext(context)
        const workspaceContext = await requireWorkspaceContext(appContext)
        if (workspaceContext instanceof Response) return workspaceContext

        const query = parseSearchParams(
          request,
          gmailSentQuerySchema,
          'Invalid messages query',
        )
        if (query.isErr()) return badRequest(query.error.message)
        const identity = {
          tenant: workspaceContext.workspaceId,
          subject: workspaceContext.session.user.id,
        }

        if (query.value.id) {
          const outcome = await runExecutorRouteEffect({
            effect: getGmailMessage(identity, query.value.id),
            request,
            event: 'gmail.messages.get.failed',
            tenant: workspaceContext.workspaceId,
            subject: workspaceContext.session.user.id,
            fallbackMessage: 'Could not load the Gmail message.',
          })
          if (!outcome.ok) return outcome.response
          return json(outcome.value)
        }

        const outcome = await runExecutorRouteEffect({
          effect: listGmail(identity, 'sent', query.value.cursor),
          request,
          event: 'gmail.messages.list.failed',
          tenant: workspaceContext.workspaceId,
          subject: workspaceContext.session.user.id,
          fallbackMessage: 'Could not load sent Gmail messages.',
        })
        if (!outcome.ok) return outcome.response
        return json(outcome.value)
      },
    },
  },
})
