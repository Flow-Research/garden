import type { Issue, IssueReaction } from './issue'
import type { Agent } from './agent'
import type { InboxItem } from './inbox'
import type { Comment, Reaction } from './comment'
import type { TimelineEntry } from './activity'
import type { Workspace, MemberWithUser, Invitation } from './workspace'
import type { Project } from './project'
import type { IssueRun, IssueRunEvent, IssueRunStatus } from './issue-run'
import type { IssueSourceBinding, IssueWorkProduct } from './issue-work-product'

// App realtime event types.
export type WSEventType =
  | 'issue:created'
  | 'issue:updated'
  | 'issue:deleted'
  | 'comment:created'
  | 'comment:updated'
  | 'comment:deleted'
  | 'agent:status'
  | 'agent:created'
  | 'agent:archived'
  | 'agent:restored'
  | 'issue_run:queued'
  | 'issue_run:started'
  | 'issue_run:event'
  | 'issue_run:status_changed'
  | 'issue_work_product:created'
  | 'issue_work_product:updated'
  | 'issue_source_binding:added'
  | 'issue_source_binding:removed'
  | 'inbox:new'
  | 'inbox:read'
  | 'inbox:archived'
  | 'inbox:batch-read'
  | 'inbox:batch-archived'
  | 'workspace:updated'
  | 'workspace:deleted'
  | 'member:added'
  | 'member:updated'
  | 'member:removed'
  | 'daemon:heartbeat'
  | 'daemon:register'
  | 'skill:created'
  | 'skill:updated'
  | 'skill:deleted'
  | 'subscriber:added'
  | 'subscriber:removed'
  | 'activity:created'
  | 'reaction:added'
  | 'reaction:removed'
  | 'issue_reaction:added'
  | 'issue_reaction:removed'
  | 'chat:message'
  | 'chat:done'
  | 'chat:session_read'
  | 'project:created'
  | 'project:updated'
  | 'project:deleted'
  | 'pin:created'
  | 'pin:deleted'
  | 'invitation:created'
  | 'invitation:accepted'
  | 'invitation:declined'
  | 'invitation:revoked'

export interface WSMessage<T = unknown> {
  type: WSEventType
  payload: T
  actor_id?: string
}

export interface IssueCreatedPayload {
  issue: Issue
}

export interface IssueUpdatedPayload {
  issue: Issue
}

export interface IssueDeletedPayload {
  issue_id: string
}

export interface AgentStatusPayload {
  agent: Agent
}

export interface AgentCreatedPayload {
  agent: Agent
}

export interface AgentArchivedPayload {
  agent: Agent
}

export interface AgentRestoredPayload {
  agent: Agent
}

export interface InboxNewPayload {
  item: InboxItem
}

export interface InboxReadPayload {
  item_id: string
  recipient_id: string
}

export interface InboxArchivedPayload {
  item_id: string
  recipient_id: string
}

export interface InboxBatchReadPayload {
  recipient_id: string
  count: number
}

export interface InboxBatchArchivedPayload {
  recipient_id: string
  count: number
}

export interface CommentCreatedPayload {
  comment: Comment
}

export interface CommentUpdatedPayload {
  comment: Comment
}

export interface CommentDeletedPayload {
  comment_id: string
  issue_id: string
}

export interface WorkspaceUpdatedPayload {
  workspace: Workspace
}

export interface WorkspaceDeletedPayload {
  workspace_id: string
}

export interface MemberUpdatedPayload {
  member: MemberWithUser
}

export interface MemberAddedPayload {
  member: MemberWithUser
  workspace_id: string
  workspaceName?: string
}

export interface MemberRemovedPayload {
  member_id: string
  user_id: string
  workspace_id: string
}

export interface SubscriberAddedPayload {
  issue_id: string
  user_type: string
  user_id: string
  reason: string
}

export interface SubscriberRemovedPayload {
  issue_id: string
  user_type: string
  user_id: string
}

export interface ActivityCreatedPayload {
  issue_id: string
  entry: TimelineEntry
}

export interface IssueRunStartedPayload {
  run: IssueRun
}

export interface IssueRunStatusChangedPayload {
  run_id: string
  issue_id: string
  status: IssueRunStatus
  previous_status: IssueRunStatus
}

export interface IssueRunEventPayload {
  event: IssueRunEvent
}

export interface IssueWorkProductCreatedPayload {
  work_product: IssueWorkProduct
}

export interface IssueWorkProductUpdatedPayload {
  work_product: IssueWorkProduct
}

export interface IssueSourceBindingAddedPayload {
  source_binding: IssueSourceBinding
}

export interface IssueSourceBindingRemovedPayload {
  source_binding_id: string
  issue_id: string
}

export interface ReactionAddedPayload {
  reaction: Reaction
  issue_id: string
}

export interface ReactionRemovedPayload {
  comment_id: string
  issue_id: string
  emoji: string
  actor_type: string
  actor_id: string
}

export interface IssueReactionAddedPayload {
  reaction: IssueReaction
  issue_id: string
}

export interface IssueReactionRemovedPayload {
  issue_id: string
  emoji: string
  actor_type: string
  actor_id: string
}

export interface ChatMessageEventPayload {
  chat_session_id: string
  message_id: string
  role: 'user' | 'assistant'
  content: string
  task_id?: string
  created_at: string
}

export interface ChatDonePayload {
  chat_session_id: string
  task_id: string
  content?: string
}

export interface ChatSessionReadPayload {
  chat_session_id: string
}

export interface ProjectCreatedPayload {
  project: Project
}

export interface ProjectUpdatedPayload {
  project: Project
}

export interface ProjectDeletedPayload {
  project_id: string
}

export interface InvitationCreatedPayload {
  invitation: Invitation
  workspaceName?: string
}

export interface InvitationAcceptedPayload {
  invitationId: string
  member: MemberWithUser
}

export interface InvitationDeclinedPayload {
  invitationId: string
  email: string
}

export interface InvitationRevokedPayload {
  invitationId: string
  email: string
}
