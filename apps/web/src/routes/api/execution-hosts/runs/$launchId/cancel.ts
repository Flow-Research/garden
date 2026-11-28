import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { handleExecutionHostRun } from '@/lib/server/execution-hosts'

export const Route = createFileRoute(
  '/api/execution-hosts/runs/$launchId/cancel',
)({
  server: {
    handlers: {
      POST: ({ context, params }) =>
        handleExecutionHostRun(
          requireAppRequestContext(context),
          params.launchId,
          'cancel',
        ),
    },
  },
})
