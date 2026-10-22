import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { setAgentStatus } from '@/lib/server/agent-status'

export const Route = createFileRoute('/api/agents/$id/restore')({
  server: {
    handlers: {
      POST: async ({ context, params }) =>
        await setAgentStatus({
          appContext: requireAppRequestContext(context),
          agentId: params.id,
          status: 'active',
        }),
    },
  },
})
