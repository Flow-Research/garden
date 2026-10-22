import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import {
  badRequest,
  json,
  requireWorkspaceContext,
} from '@/lib/server/control-plane'
import { runExecutorRouteEffect } from '@/lib/server/executor-observability'
import { sendGmail } from '@/lib/server/gmail-service'
import { parseJsonBody } from '@/lib/server/validation/common'
import { gmailComposeBodySchema } from '@/lib/server/validation/gmail'

export const Route = createFileRoute('/api/gmail/send')({
  server: {
    handlers: {
      POST: async ({ context, request }) => {
        const appContext = requireAppRequestContext(context)
        const workspaceContext = await requireWorkspaceContext(appContext)
        if (workspaceContext instanceof Response) return workspaceContext

        const body = await parseJsonBody(
          request,
          gmailComposeBodySchema,
          'Invalid message',
        )
        if (body.isErr()) return badRequest(body.error.message)

        const outcome = await runExecutorRouteEffect({
          effect: sendGmail(
            {
              tenant: workspaceContext.workspaceId,
              subject: workspaceContext.session.user.id,
            },
            body.value,
          ),
          request,
          event: 'gmail.messages.send.failed',
          tenant: workspaceContext.workspaceId,
          subject: workspaceContext.session.user.id,
          fallbackMessage: 'Could not send the Gmail message.',
        })
        if (!outcome.ok) return outcome.response
        return json(outcome.value)
      },
    },
  },
})
