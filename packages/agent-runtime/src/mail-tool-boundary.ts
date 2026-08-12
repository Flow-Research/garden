import type { ToolSet } from 'ai'

export const INBOX_EXECUTOR_MCP_TOOL_KEYS = [
  'tool_executor_execute',
  'tool_executor_skills',
  'tool_executor_resume',
] as const

export type ExecutorMcpResource =
  | { readonly kind: 'default' }
  | { readonly kind: 'toolkit'; readonly slug: string }

/**
 * Gives the hidden Inbox facet a provider catalog scoped by Executor while
 * leaving ordinary Garden chat on its existing default catalog. Executor's
 * toolkit policy is the authority for which connected-provider operations the
 * `execute` tool can discover and call.
 */
export const executorMcpResourceForRuntime = (input: {
  readonly inboxRuntime: boolean
  readonly toolkitSlug: string | null
}): ExecutorMcpResource =>
  input.inboxRuntime && input.toolkitSlug
    ? { kind: 'toolkit', slug: input.toolkitSlug }
    : { kind: 'default' }

/**
 * Keeps Inbox collaboration deliberately narrow. The copied Cloudflare panel
 * has no first-party server tools. Mail reads and provider actions arrive
 * through scoped Executor; compose is a local UI handoff.
 * Issue, document, web, sandbox, and agent-management tools remain ordinary
 * chat concerns.
 */
export const toolsForChatRuntime = (input: {
  readonly inboxRuntime: boolean
  readonly chatTools: ToolSet
}): ToolSet => {
  if (!input.inboxRuntime) return input.chatTools

  return {}
}

/** Exact model inventory for Inbox: browser composer plus scoped Executor MCP. */
export const inboxActiveToolKeys = (input: {
  readonly assembledTools: ToolSet
  readonly stableMcpTools: ToolSet
}): string[] => [
  ...(input.assembledTools.compose_mail === undefined ? [] : ['compose_mail']),
  ...INBOX_EXECUTOR_MCP_TOOL_KEYS.filter(
    (key) => input.stableMcpTools[key] !== undefined,
  ),
]
