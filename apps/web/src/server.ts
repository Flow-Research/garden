import handler from '@tanstack/react-start/server-entry'
import { routeAgentRequest } from 'agents'
import { AgentHost, WorkspaceAgent } from '@garden/agent-runtime'
import { proxyToSandbox, Sandbox } from '@cloudflare/sandbox'
import type { AppEnv } from '@/lib/server/env'

export { AgentHost }
export { WorkspaceAgent }
export { Sandbox }

type ServerEnv = AppEnv & {
  MCP_PROXY?: Fetcher
}

export default {
  async fetch(request: Request, env: ServerEnv) {
    const sandboxResponse = await proxyToSandbox(request, env)
    if (sandboxResponse) return sandboxResponse

    const url = new URL(request.url)

    if (url.pathname.startsWith('/api/mcp-proxy/')) {
      if (!env.MCP_PROXY) {
        return new Response('MCP proxy binding is not configured', { status: 503 })
      }

      const upstreamPath = url.pathname.replace('/api/mcp-proxy', '')
      const upstreamUrl = new URL(
        `${upstreamPath}${url.search}`,
        'https://garden-mcp-proxy.internal',
      )
      return env.MCP_PROXY.fetch(new Request(upstreamUrl, request))
    }

    if (url.pathname.startsWith('/agents/')) {
      const response = await routeAgentRequest(request, env)
      if (response) return response
    }

    return handler.fetch(request)
  },
} satisfies ExportedHandler<ServerEnv>
