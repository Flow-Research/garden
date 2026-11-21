import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { handleExecutionHostDirectory } from '@/lib/server/execution-hosts'

export const Route = createFileRoute('/api/execution-hosts/')({
  server: {
    handlers: {
      GET: ({ context }) =>
        handleExecutionHostDirectory(requireAppRequestContext(context)),
    },
  },
})
