export interface ChatThreadRow {
  id: string
  workspaceId: string
  ownerUserId: string
  title: string
  agentId: string
  hostName: string
  primary_issue_id: string | null
  runtime_kind: 'chat' | 'issue_run'
  runtime_key: string
  primaryIssue: {
    id: string
    identifier: string
    title: string
    status: string
  } | null
  createdAt: string
  updatedAt: string
  lastMessage: string
  archivedAt: string | null
}

export interface AgentChatSession extends ChatThreadRow {
  status: 'idle' | 'submitted' | 'streaming' | 'error' | 'archived'
  unread: boolean
  optimistic?: boolean
}

export interface ChatSession {
  id: string
  workspace_id: string
  agent_id: string
  creator_id: string
  title: string
  status: 'active' | 'archived'
  /** True when the session has any unread assistant replies. List-only. */
  has_unread: boolean
  created_at: string
  updated_at: string
}

export interface PendingChatTaskItem {
  task_id: string
  status: string
  chat_session_id: string
}

export interface PendingChatTasksResponse {
  tasks: PendingChatTaskItem[]
}

export interface ChatMessage {
  id: string
  chat_session_id: string
  role: 'user' | 'assistant'
  content: string
  task_id: string | null
  created_at: string
}

export interface SendChatMessageResponse {
  message_id: string
  task_id: string
}

export interface ChatPendingTask {
  task_id?: string
  status?: string
}
