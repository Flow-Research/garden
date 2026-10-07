import type { AgentRecordStatus } from './agent'
import type { ListIssuesParams } from './api'
import type { MemberRole } from './workspace'

/**
 * Teams are workspace-scoped groups of people and agents that share a
 * Team-scoped issue space. The product UI calls these "Teams / Departments";
 * the data model and API always say Team.
 */
export type TeamMemberKind = 'user' | 'agent'

/**
 * The caller's own membership in a Team, when one exists. The identity field
 * that does not match `member_type` is always null.
 */
export interface TeamCurrentMembership {
  id: string
  member_type: TeamMemberKind
  user_id: string | null
  agent_id: string | null
}

/**
 * Team list/detail shape. Counts are computed under the caller's visibility
 * rules: a normal Team member never receives issue counts for issues they
 * cannot read. The `can_*` flags let the frontend render controls; they are
 * never treated as the authorization decision.
 */
export interface TeamSummary {
  id: string
  workspace_id: string
  name: string
  description: string | null
  owner_user_id: string
  member_count: number
  issue_count: number
  can_manage: boolean
  can_transfer_owner: boolean
  current_membership: TeamCurrentMembership | null
  created_at: string
  updated_at: string
}

export interface Team extends TeamSummary {
  created_by: string
  /** Count of activity_event rows recorded against this Team. */
  activity_count: number
}

/**
 * A Team member is either a workspace user or a workspace agent. Display
 * fields are resolved server-side so the client does not need a second fetch
 * to render the member table.
 */
export interface TeamMember {
  id: string
  team_id: string
  workspace_id: string
  member_type: TeamMemberKind
  user_id: string | null
  agent_id: string | null
  name: string
  email: string | null
  avatar_url: string | null
  /** Workspace role for human members, null for agents. */
  workspace_role: MemberRole | null
  /** Agent record status for agent members, null for humans. */
  agent_status: AgentRecordStatus | null
  assigned_issue_count: number
  created_at: string
}

export interface ListTeamsResponse {
  teams: TeamSummary[]
  total: number
  /**
   * Distinct members (users + agents) across the caller-visible Teams. A
   * person on several Teams counts once; for normal members only their own
   * Teams are counted, so the number never leaks Teams they cannot see.
   */
  unique_member_count: number
}

export interface ListTeamMembersResponse {
  members: TeamMember[]
  total: number
}

/**
 * Membership writes are a discriminated union so a request can never carry
 * both user_id and agent_id.
 */
export type AddTeamMemberRequest =
  | { member_type: 'user'; user_id: string }
  | { member_type: 'agent'; agent_id: string }

export interface CreateTeamRequest {
  /** Trimmed, 1-100 characters. */
  name: string
  /** Maximum 5,000 characters. */
  description?: string | null
  /** Defaults to the authenticated creator. */
  owner_user_id?: string
  /** Maximum 100 entries. When provided it must contain the owner. */
  initial_members?: AddTeamMemberRequest[]
}

export interface UpdateTeamRequest {
  name?: string
  description?: string | null
}

export interface TransferTeamOwnerRequest {
  owner_user_id: string
}

/** Team issue queries reuse the existing issue filter vocabulary. */
export type ListTeamIssuesParams = Omit<ListIssuesParams, 'workspace_id'> & {
  team_id: string
}
