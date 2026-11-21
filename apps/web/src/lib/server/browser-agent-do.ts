import type { Connection, ConnectionContext, WSMessage } from 'agents'
import { Result } from 'better-result'
import {
  AgentDO as RuntimeAgentDO,
  browserChatPrincipalFromTags,
  browserChatTags,
  browserConnectionTag,
  nonChatConnectionTag,
  browserChatRefused,
  browserChatUnavailable,
} from '@garden/agent-runtime'
import { getChatFacetTarget } from './agent-do-path'
import {
  admitBrowserChatFrame,
  admitBrowserChatRequest,
} from './browser-chat-authority'

/** The SDK generates routing metadata only after the public URL is authorized. */
export function stripBrowserAgentRoutingHeaders(request: Request) {
  const headers = new Headers(request.headers)
  for (const name of [
    'x-cf-agents-subagent-url',
    'x-partykit-props',
    'x-partykit-room',
    'x-partykit-namespace',
    'x-partykit-jurisdiction',
  ])
    headers.delete(name)
  return new Request(request, { headers })
}

/** Gates the public hibernating socket entry before SDK protocol dispatch. */
export class AgentDO extends RuntimeAgentDO {
  static override options = { ...RuntimeAgentDO.options, hibernate: true }

  override async fetch(request: Request) {
    const target = getChatFacetTarget(request.url)
    if (target.kind === 'invalid')
      return new Response('Not found', { status: 404 })
    if (target.kind !== 'chat') return super.fetch(request)
    const admitted = await admitBrowserChatRequest(request, this.env)
    if (admitted.isErr())
      return Response.json(
        { error: admitted.error.message },
        {
          status: admitted.error.status,
          headers: { 'Cache-Control': 'no-store' },
        },
      )
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket')
      return super.fetch(request)
    // PartyServer also treats the client-selected _pk as a platform tag. A
    // server-generated ID prevents tag spoofing and facet connection collisions.
    const url = new URL(request.url)
    url.searchParams.set('_pk', crypto.randomUUID())
    return super.fetch(new Request(url, request))
  }

  override async getConnectionTags(
    _connection: Connection,
    context: ConnectionContext,
  ) {
    const target = getChatFacetTarget(context.request.url)
    if (target.kind === 'none')
      return [browserConnectionTag, nonChatConnectionTag]
    const admitted = await admitBrowserChatRequest(context.request, this.env)
    const binding = admitted.andThen((principal) => {
      if (principal.runtimeName !== this.name)
        return Result.err(browserChatRefused())
      return Result.try({
        try: () => browserChatTags(principal),
        catch: () => browserChatUnavailable(),
      })
    })
    if (binding.isErr()) {
      // PartyServer 0.5.8 serializes error.stack on upgrade failure. Keep that
      // adapter value public and fixed instead of exposing an error cause.
      const refusal = new Error(
        'Private chat access is unavailable. Reconnect.',
      )
      refusal.stack = refusal.message
      throw refusal
    }
    return binding.value
  }

  override async webSocketMessage(socket: WebSocket, message: WSMessage) {
    const tags = this.ctx.getTags(socket)
    if (
      tags.includes(browserConnectionTag) &&
      tags.includes(nonChatConnectionTag)
    )
      return super.webSocketMessage(socket, message)
    const principal = browserChatPrincipalFromTags(tags)
    if (principal.isErr()) {
      socket.close(1008, 'Reconnect to refresh chat access')
      return
    }
    const current = await admitBrowserChatFrame(principal.value, this.env)
    if (current.isErr()) {
      socket.close(1008, 'Chat access is unavailable')
      return
    }
    return super.webSocketMessage(socket, message)
  }
}
