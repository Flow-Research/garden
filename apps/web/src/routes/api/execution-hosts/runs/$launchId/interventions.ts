import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { handleExecutionHostRun } from '@/lib/server/execution-hosts'

export const Route = createFileRoute(
  '/api/execution-hosts/runs/$launchId/interventions',
)({
  server: {
    handlers: {
      GET: ({ context, params }) =>
        handleExecutionHostRun(
          requireAppRequestContext(context),
          params.launchId,
          'interventions',
        ),
      POST: ({ context, params }) =>
        handleExecutionHostRun(
          requireAppRequestContext(context),
          params.launchId,
          'answer',
        ),
    },
  },
})
