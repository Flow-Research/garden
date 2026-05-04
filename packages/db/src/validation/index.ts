import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import { z } from 'zod'
import {
  account,
  agent,
  chatThread,
  invitation,
  issue,
  issueComment,
  member,
  organization,
  skill,
  skillFile,
  user,
} from '../schema/index.js'

export const uuidSchema = z.string().uuid()
export const jsonObjectSchema = z.record(z.string(), z.unknown())

export const memberRoleValues = ['owner', 'admin', 'member'] as const
export const memberRoleSchema = z.enum(memberRoleValues)

export const invitationStatusValues = [
  'pending',
  'accepted',
  'rejected',
  'canceled',
] as const
export const invitationStatusSchema = z.enum(invitationStatusValues)

export const agentRecordStatusValues = [
  'active',
  'pending_approval',
  'archived',
] as const
export const agentRecordStatusSchema = z.enum(agentRecordStatusValues)

export const accountStatusValues = [
  'connected',
  'degraded',
  'disconnected',
] as const
export const accountStatusSchema = z.enum(accountStatusValues)

export const issueStatusValues = [
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'done',
  'blocked',
  'cancelled',
] as const
export const issueStatusSchema = z.enum(issueStatusValues)

export const issuePriorityValues = [
  'urgent',
  'high',
  'medium',
  'low',
  'none',
] as const
export const issuePrioritySchema = z.enum(issuePriorityValues)

export const issueDbAssigneeTypeValues = ['user', 'agent'] as const
export const issueDbAssigneeTypeSchema = z.enum(issueDbAssigneeTypeValues)

export const skillSourceTypeValues = ['manual', 'skills.sh'] as const
export const skillSourceTypeSchema = z.enum(skillSourceTypeValues)

export const userSelectSchema = createSelectSchema(user, {
  id: () => uuidSchema,
  email: () => z.string().email(),
  name: (schema) => schema.trim(),
})

export const userUpdateSchema = createUpdateSchema(user, {
  id: () => uuidSchema,
  email: () => z.string().email(),
  name: (schema) => schema.trim().min(1),
})

export const organizationSelectSchema = createSelectSchema(organization, {
  id: () => uuidSchema,
  name: (schema) => schema.trim().min(1),
  slug: (schema) => schema.trim().min(1),
  settings: () => jsonObjectSchema,
})

export const organizationInsertSchema = createInsertSchema(organization, {
  id: () => uuidSchema,
  name: (schema) => schema.trim().min(1),
  slug: (schema) => schema.trim().min(1),
  settings: () => jsonObjectSchema,
})

export const organizationUpdateSchema = createUpdateSchema(organization, {
  id: () => uuidSchema,
  name: (schema) => schema.trim().min(1),
  slug: (schema) => schema.trim().min(1),
  settings: () => jsonObjectSchema,
})

export const memberSelectSchema = createSelectSchema(member, {
  id: () => uuidSchema,
  organizationId: () => uuidSchema,
  userId: () => uuidSchema,
  role: () => memberRoleSchema,
})

export const invitationSelectSchema = createSelectSchema(invitation, {
  id: () => uuidSchema,
  organizationId: () => uuidSchema,
  inviterId: () => uuidSchema,
  email: () => z.string().email(),
  role: () => memberRoleSchema,
  status: () => invitationStatusSchema,
})

export const invitationInsertSchema = createInsertSchema(invitation, {
  id: () => uuidSchema,
  organizationId: () => uuidSchema,
  inviterId: () => uuidSchema,
  email: () => z.string().email(),
  role: () => memberRoleSchema,
  status: () => invitationStatusSchema,
})

export const agentSelectSchema = createSelectSchema(agent, {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  ownerUserId: () => uuidSchema,
  reportsTo: () => uuidSchema,
  name: (schema) => schema.trim().min(1),
  roleTitle: (schema) => schema.trim().min(1),
  status: () => agentRecordStatusSchema,
})

export const agentInsertSchema = createInsertSchema(agent, {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  ownerUserId: () => uuidSchema,
  reportsTo: () => uuidSchema,
  name: (schema) => schema.trim().min(1),
  roleTitle: (schema) => schema.trim().min(1),
  status: () => agentRecordStatusSchema,
})

export const agentUpdateSchema = createUpdateSchema(agent, {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  ownerUserId: () => uuidSchema,
  reportsTo: () => uuidSchema,
  name: (schema) => schema.trim().min(1),
  roleTitle: (schema) => schema.trim().min(1),
  status: () => agentRecordStatusSchema,
})

export const chatThreadSelectSchema = createSelectSchema(chatThread, {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  ownerUserId: () => uuidSchema,
  title: (schema) => schema.trim().min(1),
})

export const chatThreadInsertSchema = createInsertSchema(chatThread, {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  ownerUserId: () => uuidSchema,
  title: (schema) => schema.trim().min(1),
})

export const chatThreadUpdateSchema = createUpdateSchema(chatThread, {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  ownerUserId: () => uuidSchema,
  title: (schema) => schema.trim().min(1),
})

export const issueSelectSchema = createSelectSchema(issue, {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  title: (schema) => schema.trim().min(1),
  status: () => issueStatusSchema,
  priority: () => issuePrioritySchema,
  assigneeType: () => issueDbAssigneeTypeSchema,
  assigneeId: () => uuidSchema,
  parentId: () => uuidSchema,
  projectId: () => uuidSchema,
  createdBy: () => uuidSchema,
})

export const issueInsertSchema = createInsertSchema(issue, {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  title: (schema) => schema.trim().min(1),
  status: () => issueStatusSchema,
  priority: () => issuePrioritySchema,
  assigneeType: () => issueDbAssigneeTypeSchema,
  assigneeId: () => uuidSchema,
  parentId: () => uuidSchema,
  projectId: () => uuidSchema,
  createdBy: () => uuidSchema,
})

export const issueUpdateSchema = createUpdateSchema(issue, {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  title: (schema) => schema.trim().min(1),
  status: () => issueStatusSchema,
  priority: () => issuePrioritySchema,
  assigneeType: () => issueDbAssigneeTypeSchema,
  assigneeId: () => uuidSchema,
  parentId: () => uuidSchema,
  projectId: () => uuidSchema,
  createdBy: () => uuidSchema,
})

export const issueCommentSelectSchema = createSelectSchema(issueComment, {
  id: () => uuidSchema,
  issueId: () => uuidSchema,
  authorId: () => uuidSchema,
  authorType: z.enum(['user', 'agent']),
  body: (schema) => schema.trim().min(1),
})

export const issueCommentInsertSchema = createInsertSchema(issueComment, {
  id: () => uuidSchema,
  issueId: () => uuidSchema,
  authorId: () => uuidSchema,
  authorType: z.enum(['user', 'agent']),
  body: (schema) => schema.trim().min(1),
})

export const issueCommentUpdateSchema = createUpdateSchema(issueComment, {
  id: () => uuidSchema,
  issueId: () => uuidSchema,
  authorId: () => uuidSchema,
  authorType: z.enum(['user', 'agent']),
  body: (schema) => schema.trim().min(1),
})

export const skillSelectSchema = createSelectSchema(skill, {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  name: (schema) => schema.trim().min(1),
  slug: (schema) => schema.trim().min(1),
  sourceType: () => skillSourceTypeSchema,
  authorId: () => uuidSchema,
})

export const skillInsertSchema = createInsertSchema(skill, {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  name: (schema) => schema.trim().min(1),
  slug: (schema) => schema.trim().min(1),
  sourceType: () => skillSourceTypeSchema,
  authorId: () => uuidSchema,
})

export const skillUpdateSchema = createUpdateSchema(skill, {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  name: (schema) => schema.trim().min(1),
  slug: (schema) => schema.trim().min(1),
  sourceType: () => skillSourceTypeSchema,
  authorId: () => uuidSchema,
})

export const skillFileSelectSchema = createSelectSchema(skillFile, {
  id: () => uuidSchema,
  skillId: () => uuidSchema,
  path: (schema) => schema.trim().min(1),
})

export const skillFileInsertSchema = createInsertSchema(skillFile, {
  id: () => uuidSchema,
  skillId: () => uuidSchema,
  path: (schema) => schema.trim().min(1),
})

export const accountUpdateSchema = createUpdateSchema(account, {
  id: () => uuidSchema,
  userId: () => uuidSchema,
  workspaceId: () => uuidSchema,
  status: () => accountStatusSchema,
})

export * from './issue-runs.js'
