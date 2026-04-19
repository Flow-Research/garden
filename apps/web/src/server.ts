import handler from '@tanstack/react-start/server-entry'
import { routeAgentRequest } from 'agents'
import { PrimaryAgent } from '@accelerate/agent-runtime'

export { PrimaryAgent }

export default {
  async fetch(request: Request, env: Env) {
    if (new URL(request.url).pathname.startsWith('/agents/')) {
      const response = await routeAgentRequest(request, env)
      if (response) return response
    }

    return handler.fetch(request)
  },
} satisfies ExportedHandler<Env>
