import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import {
  json,
  notFound,
  requireWorkspaceContext,
} from '@/lib/server/control-plane'
import { runExecutorRouteEffect } from '@/lib/server/executor-observability'
import { deleteGmailDraft, getGmailDraft } from '@/lib/server/gmail-service'

export const Route = createFileRoute('/api/gmail/drafts/$draftId')({
  server: {
    handlers: {
      GET: async ({ context, request, params }) => {
        const appContext = requireAppRequestContext(context)
        const workspaceContext = await requireWorkspaceContext(appContext)
        if (workspaceContext instanceof Response) return workspaceContext
        if (!params.draftId) return notFound('Draft not found')

        const outcome = await runExecutorRouteEffect({
          effect: getGmailDraft(
            {
              tenant: workspaceContext.workspaceId,
              subject: workspaceContext.session.user.id,
            },
            params.draftId,
          ),
          request,
          event: 'gmail.drafts.get.failed',
          tenant: workspaceContext.workspaceId,
          subject: workspaceContext.session.user.id,
          fallbackMessage: 'Could not load the Gmail draft.',
        })
        if (!outcome.ok) return outcome.response
        return json(outcome.value)
      },
      DELETE: async ({ context, request, params }) => {
        const appContext = requireAppRequestContext(context)
        const workspaceContext = await requireWorkspaceContext(appContext)
        if (workspaceContext instanceof Response) return workspaceContext
        if (!params.draftId) return notFound('Draft not found')

        const outcome = await runExecutorRouteEffect({
          effect: deleteGmailDraft(
            {
              tenant: workspaceContext.workspaceId,
              subject: workspaceContext.session.user.id,
            },
            params.draftId,
          ),
          request,
          event: 'gmail.drafts.delete.failed',
          tenant: workspaceContext.workspaceId,
          subject: workspaceContext.session.user.id,
          fallbackMessage: 'Could not discard the Gmail draft.',
        })
        if (!outcome.ok) return outcome.response
        return json({ ok: true })
      },
    },
  },
})
