/**
 * Single source of truth for "is this tool part still doing something".
 *
 * Why this exists: the same 6-line state test
 *   state === 'streaming' || 'loading' || 'input-streaming' ||
 *   'input-available' || 'running' || 'waiting-approval'
 * was copy-pasted inline in three places — `getToolActivityItem`
 * (chat-message-parts), `MessageToolActivity` (chat-tool-activity), and
 * `latestHasMovingActivity` (chat-timeline). Adding or renaming a tool state
 * (e.g. the SDK's `output-error`) meant editing all three in lockstep, and they
 * had already drifted. Centralizing the predicate makes "active" a deep concept
 * behind a one-word interface: callers ask the question, this module owns the
 * answer.
 *
 * States come from the AI SDK / Cloudflare ai-chat tool part lifecycle:
 * input-streaming → input-available → (waiting-approval) → output-available |
 * output-error. `getToolPartState` is the SDK accessor; we stringify because
 * legacy/normalized parts can carry the older `streaming`/`loading`/`running`
 * labels.
 */
import { getToolPartState } from '@cloudflare/ai-chat/react'
import { isToolUIPart } from 'ai'
import type { ChatUiMessage } from '../chat-runtime-provider'

/**
 * Tool-lifecycle states where the tool has not produced a terminal result yet —
 * it is streaming input, executing, or blocking on a human approval. Anything
 * not in this set (output-available, output-error, denied, complete) is settled.
 */
export const ACTIVE_TOOL_STATES: ReadonlySet<string> = new Set([
  'streaming',
  'loading',
  'input-streaming',
  'input-available',
  'running',
  'waiting-approval',
])

/** True when a raw tool-state string is still in flight (see ACTIVE_TOOL_STATES). */
export function isToolStateActive(state: string): boolean {
  return ACTIVE_TOOL_STATES.has(state)
}

/**
 * True when a message part is a tool part that is still in flight. Returns false
 * for non-tool parts so callers can use it directly inside `parts.some(...)`.
 */
export function isToolPartActive(
  part: ChatUiMessage['parts'][number],
): boolean {
  if (!isToolUIPart(part)) return false
  return isToolStateActive(String(getToolPartState(part)))
}
