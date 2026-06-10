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
  permissionRequests: (threadId: string) =>
    ['chat', 'permission-requests', threadId] as const,
}

export type ThreadPermissionRequest = {
  id: string
  status: 'pending' | 'approved' | 'denied'
  tool_call_id: string
  pending_agent_id: string | null
}

/**
 * Reads this thread's agent_proposal permission requests with their
 * server-authoritative status. The propose_agent approval card consults this to
 * reconcile after a reconnect instead of trusting stale tool-output snapshots or
 * local optimistic state (B2). Scoped to the thread server-side via thread_id.
 */
export function listThreadPermissionRequests(
  threadId: string,
): Promise<{ ok: boolean; requests: ThreadPermissionRequest[] }> {
  return getApiTransport().request(
    `/api/chat/threads/${threadId}/permission-requests`,
  )
}

function rowToSession(row: ChatThreadRow): AgentChatSession {
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
    session.runtime_kind === 'chat' &&
    !session.primary_issue_id &&
    !session.primaryIssue &&
    session.runtime_key === session.id &&
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
  id?: string
  primaryIssueId?: string | null
  title?: string
  workspaceId: string
}) {
  const search = new URLSearchParams({ workspace_id: args.workspaceId })
  const row = await getApiTransport().request<ChatThreadRow>(
    `/api/chat/threads?${search}`,
    {
      method: 'POST',
      body: JSON.stringify({
        id: args.id,
        title: args.title,
        agent_id: args.agentId ?? undefined,
        exclude_thread_ids:
          args.excludeThreadIds && args.excludeThreadIds.length > 0
            ? args.excludeThreadIds
            : undefined,
        primary_issue_id: args.primaryIssueId ?? undefined,
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

export async function setChatThreadPrimaryIssue(
  threadId: string,
  issueId: string | null,
) {
  const row = await getApiTransport().request<ChatThreadRow>(
    `/api/chat/threads/${threadId}/primary-issue`,
    {
      method: 'POST',
      body: JSON.stringify({ issue_id: issueId }),
    },
  )
  return rowToSession(row)
}

export async function openChatForIssue(args: {
  workspaceId: string
  issueId: string
  issueTitle: string
  agentId: string | null
  threadId?: string
}): Promise<AgentChatSession> {
  return createChatThread({
    id: args.threadId,
    workspaceId: args.workspaceId,
    agentId: args.agentId,
    title: args.issueTitle,
    primaryIssueId: args.issueId,
  })
}

export function resolveToolApproval(args: {
  approved: boolean
  threadId: string
  toolCallId?: string
  permissionRequestId?: string
}): Promise<{ toolCallIds?: unknown[] }> {
  return getApiTransport().request(
    `/api/chat/threads/${args.threadId}/tool-approval`,
    {
      method: 'POST',
      body: JSON.stringify({
        ...(args.toolCallId ? { toolCallId: args.toolCallId } : {}),
        ...(args.permissionRequestId
          ? { permission_request_id: args.permissionRequestId }
          : {}),
        approved: args.approved,
      }),
    },
  )
}
