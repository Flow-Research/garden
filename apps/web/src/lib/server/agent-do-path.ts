import { parseSubAgentPath } from 'agents'

/** Path prefix the Agents SDK uses for Durable Object HTTP/WebSocket traffic. */
export const AGENT_DO_PATH_PREFIX = '/agents/agent-d-o/'

/**
 * Whether a request path is agent Durable Object traffic.
 *
 * Before: server.ts claimed every `/agents/*` path, so a direct load or reload
 * of the agent detail page `/agents/<id>` hit the DO auth gate and returned a
 * plain "Not found". After: only the SDK's `agent-d-o` namespace is claimed;
 * page routes fall through to the app router.
 */
export function isAgentDoPath(pathname: string) {
  return pathname.startsWith(AGENT_DO_PATH_PREFIX)
}

/** Identifies the supported, single-level private chat facet route. */
export function getChatFacetTarget(
  requestUrl: string,
):
  | { kind: 'none' }
  | { kind: 'chat'; threadName: string }
  | { kind: 'invalid' } {
  const url = new URL(requestUrl)
  const parts = url.pathname.split('/').filter(Boolean).slice(3)
  const hasChatMarker = parts.some(
    (part, index) => part === 'chat-sub-agent' && parts[index - 1] === 'sub',
  )
  let match = parseSubAgentPath(url.href)
  let threadName: string | undefined
  let depth = 0
  while (match) {
    depth += 1
    if (match.childClass === 'ChatSubAgent') threadName = match.childName
    url.pathname = match.remainingPath
    match = parseSubAgentPath(url.href)
  }
  if (!threadName && !hasChatMarker) return { kind: 'none' }
  // Chat has no nested facets. Count raw markers too: the SDK skips malformed
  // names while searching for a later routable child.
  if (
    !threadName ||
    depth !== 1 ||
    parts.filter((part) => part === 'sub').length !== 1
  ) {
    return { kind: 'invalid' }
  }
  return { kind: 'chat', threadName }
}
