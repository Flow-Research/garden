import handler from '@tanstack/react-start/server-entry'
import { routeAgentRequest } from 'agents'
import { PrimaryAgent } from '@garden/agent-runtime'
import { proxyToSandbox, Sandbox } from '@cloudflare/sandbox'

export { PrimaryAgent }
export { Sandbox }

export default {
  async fetch(request: Request, env: Env) {
    const sandboxResponse = await proxyToSandbox(request, env)
    if (sandboxResponse) return sandboxResponse

    const url = new URL(request.url)

    if (url.pathname.startsWith('/agents/')) {
      const response = await routeAgentRequest(request, env)
      if (response) return response
    }

    return handler.fetch(request)
  },
} satisfies ExportedHandler<Env>
