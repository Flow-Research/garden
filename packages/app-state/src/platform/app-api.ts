import type {
  Agent,
  AgentSkill,
  AssigneeFrequencyEntry,
  Attachment,
  Comment,
  CreateAgentRequest,
  CreateIssueRequest,
  CreateMemberRequest,
  InboxItem,
  Invitation,
  Issue,
  IssueReaction,
  IssueRun,
  IssueRunEvent,
  IssueSubscriber,
  IssueUsageSummary,
  IssueWorkProduct,
  ListIssuesParams,
  ListIssuesResponse,
  ListProjectsResponse,
  MemberWithUser,
  Reaction,
  SearchIssuesResponse,
  SetAgentSkillsRequest,
  Skill,
  TimelineEntry,
  UpdateIssueRequest,
  UpdateMeRequest,
  UpdateMemberRequest,
  Workspace,
} from '@garden/core/types'

export type Api = {
  getBaseUrl: () => string
  logout: () => Promise<void>
  setWorkspaceHeader: (id: string | null) => void
  setWorkspaceId: (id: string | null) => Promise<void>
  updateMe: (data: UpdateMeRequest) => Promise<unknown>
  uploadFile: (
    file: File,
    context?: { commentId?: string; issueId?: string },
  ) => Promise<Attachment>
  deleteAttachment: (id: string) => Promise<void>

  listWorkspaces: () => Promise<Workspace[]>
  createWorkspace: (data: {
    context?: string
    description?: string
    name: string
    slug: string
  }) => Promise<Workspace>
  updateWorkspace: (
    id: string,
    data: {
      context?: string
      description?: string
      name?: string
      settings?: Record<string, unknown>
    },
  ) => Promise<Workspace>
  leaveWorkspace: (args: {
    memberId: string
    workspaceId: string
  }) => Promise<void>
  listMembers: (workspaceId: string) => Promise<MemberWithUser[]>
  createMember: (
    workspaceId: string,
    data: CreateMemberRequest,
  ) => Promise<Invitation>
  updateMember: (
    workspaceId: string,
    memberId: string,
    data: UpdateMemberRequest,
  ) => Promise<MemberWithUser>
  deleteMember: (workspaceId: string, memberId: string) => Promise<void>
  listWorkspaceInvitations: (workspaceId: string) => Promise<Invitation[]>
  revokeInvitation: (workspaceId: string, invitationId: string) => Promise<void>
  listAgents: (params?: {
    include_archived?: boolean
    workspace_id?: string
  }) => Promise<Agent[]>
  getAgent: (agentId: string) => Promise<Agent>
  createAgent: (data: CreateAgentRequest) => Promise<Agent>
  listAgentSkills: (agentId: string) => Promise<AgentSkill[]>
  setAgentSkills: (
    agentId: string,
    data: SetAgentSkillsRequest,
  ) => Promise<void>
  listSkills: (params?: { workspace_id?: string }) => Promise<Skill[]>
  getAssigneeFrequency: (params?: {
    workspace_id?: string
  }) => Promise<AssigneeFrequencyEntry[]>

  listIssues: (params?: ListIssuesParams) => Promise<ListIssuesResponse>
  searchIssues: (params: {
    include_closed?: boolean
    limit?: number
    offset?: number
    q: string
    signal?: AbortSignal
  }) => Promise<SearchIssuesResponse>
  getIssue: (id: string) => Promise<Issue>
  createIssue: (data: CreateIssueRequest) => Promise<Issue>
  updateIssue: (id: string, data: UpdateIssueRequest) => Promise<Issue>
  deleteIssue: (id: string) => Promise<void>
  batchUpdateIssues: (
    issueIds: string[],
    updates: UpdateIssueRequest,
  ) => Promise<{ updated: number }>
  batchDeleteIssues: (issueIds: string[]) => Promise<{ deleted: number }>
  listChildIssues: (id: string) => Promise<{ issues: Issue[] }>
  getChildIssueProgress: (params?: { workspace_id?: string }) => Promise<{
    progress: { done: number; parent_issue_id: string; total: number }[]
  }>
  createComment: (
    issueId: string,
    content: string,
    type?: string,
    parentId?: string,
    attachmentIds?: string[],
  ) => Promise<Comment>
  updateComment: (commentId: string, content: string) => Promise<Comment>
  deleteComment: (commentId: string) => Promise<void>
  listTimeline: (issueId: string) => Promise<TimelineEntry[]>
  addReaction: (commentId: string, emoji: string) => Promise<Reaction>
  removeReaction: (commentId: string, emoji: string) => Promise<void>
  addIssueReaction: (issueId: string, emoji: string) => Promise<IssueReaction>
  removeIssueReaction: (issueId: string, emoji: string) => Promise<void>
  listIssueSubscribers: (issueId: string) => Promise<IssueSubscriber[]>
  subscribeToIssue: (
    issueId: string,
    userId?: string,
    userType?: string,
  ) => Promise<void>
  unsubscribeFromIssue: (
    issueId: string,
    userId?: string,
    userType?: string,
  ) => Promise<void>
  getActiveRun: (issueId: string) => Promise<{
    run: IssueRun | null
    work_products: IssueWorkProduct[]
    events: IssueRunEvent[]
  }>
  getRunEvents: (
    issueId: string,
    params?: { after?: number; limit?: number },
  ) => Promise<IssueRunEvent[]>
  cancelRun: (issueId: string, reason?: string) => Promise<unknown>
  getIssueUsage: (issueId: string) => Promise<IssueUsageSummary>

  listInbox: (params?: { workspace_id?: string }) => Promise<InboxItem[]>
  markInboxRead: (id: string) => Promise<unknown>
  archiveInbox: (id: string) => Promise<unknown>
  markAllInboxRead: () => Promise<unknown>
  archiveAllInbox: () => Promise<unknown>
  archiveAllReadInbox: () => Promise<unknown>
  archiveCompletedInbox: () => Promise<unknown>

  listProjects: () => Promise<ListProjectsResponse>
}
