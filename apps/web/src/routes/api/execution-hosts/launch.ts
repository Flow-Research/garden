import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { handleExecutionHostAction } from '@/lib/server/execution-hosts'

export const Route = createFileRoute('/api/execution-hosts/launch')({
  server: {
    handlers: {
      POST: ({ context }) =>
        handleExecutionHostAction(requireAppRequestContext(context), 'launch'),
    },
  },
})
