export type MemberRole = 'owner' | 'admin' | 'member'
export type InvitationStatus = 'pending' | 'accepted' | 'rejected' | 'canceled'

export interface Workspace {
  id: string
  name: string
  slug: string
  description: string | null
  context: string | null
  settings: Record<string, unknown>
  issue_prefix: string
  created_at: string
  updated_at: string
}

export interface Member {
  id: string
  workspace_id: string
  user_id: string
  role: MemberRole
  created_at: string
}

export interface User {
  id: string
  name: string
  email: string
  avatar_url: string | null
  created_at: string
  updated_at: string
}

export interface MemberWithUser {
  id: string
  workspace_id: string
  user_id: string
  role: MemberRole
  created_at: string
  name: string
  email: string
  avatar_url: string | null
}

export interface Invitation {
  id: string
  organizationId: string
  inviterId: string
  email: string
  role: MemberRole
  status: InvitationStatus
  createdAt: string
  expiresAt: string
  inviterName?: string
  inviterEmail?: string
  organizationName?: string
}
