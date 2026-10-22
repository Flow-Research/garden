/**
 * Keeps the Garden-to-Executor RPC request open past Decide's documented
 * four-minute analysis deadline. The 30-second margin lets a completed
 * analysis cross the Executor and Garden response boundaries. The Agents SDK
 * default is 60 seconds, which ended valid analyses before the MCP call
 * completed.
 */
export const EXECUTOR_MCP_RPC_TIMEOUT_MS = 4 * 60 * 1000 + 30 * 1000
