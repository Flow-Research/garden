/**
 * Keeps the Garden-to-Executor RPC request open for Decide's documented
 * four-minute analysis window. The Agents SDK default is 60 seconds, which
 * ended valid long-running analyses before the upstream MCP call completed.
 */
export const EXECUTOR_MCP_RPC_TIMEOUT_MS = 4 * 60 * 1000
