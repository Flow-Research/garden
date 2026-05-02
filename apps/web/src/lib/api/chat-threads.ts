import type { AgentChatSession, ChatThreadRow } from '@garden/core/types'
import { getApiTransport } from './state'

export const NEW_SESSION_TITLE = 'New Chat'

export const chatKeys = {
  all: (wsId: string) => ['chat', wsId] as const,
  sessions: (wsId: string) => [...chatKeys.all(wsId), 'sessions'] as const,
  allSessions: (wsId: string) =>
    [...chatKeys.all(wsId), 'sessions', 'all'] as const,
  session: (wsId: string, id: string) =>
    [...chatKeys.all(wsId), 'session', id] as const,
  messages: (sessionId: string) => ['chat', 'messages', sessionId] as const,
  pendingTask: (sessionId: string) =>
    ['chat', 'pending-task', sessionId] as const,
  pendingTasks: (wsId: string) =>
    [...chatKeys.all(wsId), 'pending-tasks'] as const,
  taskMessages: (taskId: string) => ['task-messages', taskId] as const,
}

export function rowToSession(row: ChatThreadRow): AgentChatSession {
  return {
    ...row,
    status: row.archivedAt ? 'archived' : 'idle',
    unread: false,
  }
}

export function sortSessions(sessions: AgentChatSession[]) {
  return [...sessions].sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
  )
}

export function isPendingFirstTurn(session: AgentChatSession) {
  return (
    session.title.trim().toLowerCase() === NEW_SESSION_TITLE.toLowerCase() &&
    session.lastMessage.trim().length === 0
  )
}

export async function listChatThreads(workspaceId: string) {
  const search = new URLSearchParams({ workspace_id: workspaceId })
  const rows = await getApiTransport().request<ChatThreadRow[]>(
    `/api/chat/threads?${search}`,
  )
  return sortSessions(rows.filter((row) => !row.archivedAt).map(rowToSession))
}

export async function createChatThread(args: {
  agentId?: string | null
  excludeThreadIds?: string[]
  title?: string
  workspaceId: string
}) {
  const search = new URLSearchParams({ workspace_id: args.workspaceId })
  const row = await getApiTransport().request<ChatThreadRow>(
    `/api/chat/threads?${search}`,
    {
      method: 'POST',
      body: JSON.stringify({
        title: args.title,
        agent_id: args.agentId ?? undefined,
        exclude_thread_ids:
          args.excludeThreadIds && args.excludeThreadIds.length > 0
            ? args.excludeThreadIds
            : undefined,
      }),
    },
  )
  return rowToSession(row)
}

export async function updateChatThread(
  threadId: string,
  body: Record<string, unknown>,
) {
  const row = await getApiTransport().request<ChatThreadRow>(
    `/api/chat/threads/${threadId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(body),
    },
  )
  return rowToSession(row)
}

export function deleteChatThread(threadId: string): Promise<void> {
  return getApiTransport().request(`/api/chat/threads/${threadId}`, {
    method: 'DELETE',
  })
}

export function resolveToolApproval(args: {
  approved: boolean
  threadId: string
  toolCallId: string
}): Promise<{ toolCallIds?: unknown[] }> {
  return getApiTransport().request(
    `/api/chat/threads/${args.threadId}/tool-approval`,
    {
      method: 'POST',
      body: JSON.stringify({
        toolCallId: args.toolCallId,
        approved: args.approved,
      }),
    },
  )
}
