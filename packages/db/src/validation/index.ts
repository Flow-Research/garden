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
  permissionRequest,
  skill,
  skillFile,
  user,
} from '../schema/index.js'
import {
  issueCommentAuthorTypeValues,
  issueDbAssigneeTypeValues,
  issuePriorityValues,
  issueStatusValues,
} from '../schema/issue-values.js'

export {
  issueCommentAuthorTypeValues,
  issueDbAssigneeTypeValues,
  issuePriorityValues,
  issueStatusValues,
} from '../schema/issue-values.js'

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

export const issueStatusSchema = z.enum(issueStatusValues)

export const issuePrioritySchema = z.enum(issuePriorityValues)

export const issueDbAssigneeTypeSchema = z.enum(issueDbAssigneeTypeValues)
export const issueCommentAuthorTypeSchema = z.enum(issueCommentAuthorTypeValues)

export const skillSourceTypeValues = ['manual', 'skills.sh'] as const
export const skillSourceTypeSchema = z.enum(skillSourceTypeValues)

export const issueCommentMentionsSchema = z
  .object({
    agents: z.array(uuidSchema),
    users: z.array(uuidSchema),
  })
  .strict()

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
  permissions: () => jsonObjectSchema.nullable(),
  status: () => agentRecordStatusSchema,
})

export const agentInsertSchema = createInsertSchema(agent, {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  ownerUserId: () => uuidSchema,
  reportsTo: () => uuidSchema,
  name: (schema) => schema.trim().min(1),
  roleTitle: (schema) => schema.trim().min(1),
  permissions: () => jsonObjectSchema.optional().nullable(),
  status: () => agentRecordStatusSchema,
})

export const agentUpdateSchema = createUpdateSchema(agent, {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  ownerUserId: () => uuidSchema,
  reportsTo: () => uuidSchema,
  name: (schema) => schema.trim().min(1),
  roleTitle: (schema) => schema.trim().min(1),
  permissions: () => jsonObjectSchema.optional().nullable(),
  status: () => agentRecordStatusSchema,
})

export const chatThreadSelectSchema = createSelectSchema(chatThread, {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  ownerUserId: () => uuidSchema,
  primaryIssueId: () => uuidSchema.nullable(),
  runtimeKind: (schema) => schema.refine((value) => value === 'chat' || value === 'issue_run'),
  runtimeKey: () => uuidSchema,
  title: (schema) => schema.trim().min(1),
})

export const chatThreadInsertSchema = createInsertSchema(chatThread, {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  ownerUserId: () => uuidSchema,
  primaryIssueId: () => uuidSchema.optional().nullable(),
  runtimeKind: (schema) => schema.optional().refine((value) => value === undefined || value === 'chat' || value === 'issue_run'),
  runtimeKey: () => uuidSchema.optional(),
  title: (schema) => schema.trim().min(1),
})

export const chatThreadUpdateSchema = createUpdateSchema(chatThread, {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  ownerUserId: () => uuidSchema,
  primaryIssueId: () => uuidSchema.optional().nullable(),
  runtimeKind: (schema) => schema.optional().refine((value) => value === undefined || value === 'chat' || value === 'issue_run'),
  runtimeKey: () => uuidSchema.optional(),
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
  permissionsOverride: () => jsonObjectSchema.nullable(),
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
  permissionsOverride: () => jsonObjectSchema.optional().nullable(),
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
  permissionsOverride: () => jsonObjectSchema.optional().nullable(),
  createdBy: () => uuidSchema,
})

export const issueCommentSelectSchema = createSelectSchema(issueComment, {
  id: () => uuidSchema,
  issueId: () => uuidSchema,
  authorId: () => uuidSchema,
  authorType: () => issueCommentAuthorTypeSchema,
  body: (schema) => schema.trim().min(1),
  mentions: () => issueCommentMentionsSchema.nullable(),
})

export const issueCommentInsertSchema = createInsertSchema(issueComment, {
  id: () => uuidSchema,
  issueId: () => uuidSchema,
  authorId: () => uuidSchema,
  authorType: () => issueCommentAuthorTypeSchema,
  body: (schema) => schema.trim().min(1),
  mentions: () => issueCommentMentionsSchema.nullable(),
})

export const issueCommentUpdateSchema = createUpdateSchema(issueComment, {
  id: () => uuidSchema,
  issueId: () => uuidSchema,
  authorId: () => uuidSchema,
  authorType: () => issueCommentAuthorTypeSchema,
  body: (schema) => schema.trim().min(1),
  mentions: () => issueCommentMentionsSchema.nullable(),
})

export const permissionRequestStatusValues = [
  'pending',
  'approved',
  'denied',
] as const
export const permissionRequestStatusSchema = z.enum(
  permissionRequestStatusValues,
)

export const permissionRequestKindValues = [
  'connector_write',
  'agent_proposal',
] as const
export const permissionRequestKindSchema = z.enum(permissionRequestKindValues)

export const permissionRequestSelectSchema = createSelectSchema(
  permissionRequest,
  {
    id: () => uuidSchema,
    agentId: () => uuidSchema,
    capabilityId: () => uuidSchema,
    issueId: () => uuidSchema,
    runId: () => uuidSchema,
    argsJson: () => jsonObjectSchema,
    status: () => permissionRequestStatusSchema,
    kind: () => permissionRequestKindSchema,
    resolvedBy: () => uuidSchema,
  },
)

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
