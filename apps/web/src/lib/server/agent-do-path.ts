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
