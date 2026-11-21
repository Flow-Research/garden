import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { handleExecutionHostAction } from '@/lib/server/execution-hosts'

export const Route = createFileRoute('/api/execution-hosts/receive')({
  server: {
    handlers: {
      POST: ({ context }) =>
        handleExecutionHostAction(requireAppRequestContext(context), 'receive'),
    },
  },
})
