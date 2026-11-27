import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { requireWorkspaceContext } from '@/lib/server/control-plane'
import { diagnoseDecide } from '@/lib/server/executor-engine/decide-diagnostic'
import { runExecutorRouteEffect } from '@/lib/server/executor-observability'

export const Route = createFileRoute('/api/executor/decide/diagnose')({
  server: {
    handlers: {
      /** Runs the user-scoped Decide health check without exposing provider data. */
      POST: async ({ context, request }) => {
        const appContext = requireAppRequestContext(context)
        const workspaceContext = await requireWorkspaceContext(appContext)
        if (workspaceContext instanceof Response) return workspaceContext

        const tenant = workspaceContext.workspaceId
        const subject = workspaceContext.session.user.id
        const outcome = await runExecutorRouteEffect({
          effect: diagnoseDecide({ tenant, subject }),
          request,
          event: 'executor.decide_diagnostic.failed',
          fallbackMessage: 'Decide diagnostic is unavailable.',
          tenant,
          subject,
        })
        if (!outcome.ok) return outcome.response
        return Response.json(outcome.value)
      },
    },
  },
})
