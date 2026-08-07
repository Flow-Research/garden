import {
  createInsertSchema,
  createSelectSchema,
  createUpdateSchema,
} from 'drizzle-zod'
import { z } from 'zod'
import {
  inboxDismissal,
  issueRun,
  issueRunEvent,
  issueSourceBinding,
  issueWorkProduct,
} from '../schema/index.js'
import {
  connectorIdValues,
  issueRunEventLevelValues,
  issueRunEventStreamValues,
  issueRunEventTypeValues,
  issueRunStatusValues,
  issueWorkProductReviewStateValues,
  issueWorkProductStatusValues,
  issueWorkProductTypeValues,
  sourceKindValues,
} from '../schema/issue-values.js'

export {
  connectorIdValues,
  issueRunEventLevelValues,
  issueRunEventStreamValues,
  issueRunEventTypeValues,
  issueRunStatusValues,
  issueWorkProductReviewStateValues,
  issueWorkProductStatusValues,
  issueWorkProductTypeValues,
  sourceKindValues,
} from '../schema/issue-values.js'

const uuidSchema = z.string().uuid()
const jsonObjectSchema = z.record(z.string(), z.unknown())

export const issueRunStatusSchema = z.enum(issueRunStatusValues)

export const issueRunEventTypeSchema = z.enum(issueRunEventTypeValues)

export const issueRunEventStreamSchema = z.enum(issueRunEventStreamValues)

export const issueRunEventLevelSchema = z.enum(issueRunEventLevelValues)

export const issueWorkProductTypeSchema = z.enum(issueWorkProductTypeValues)

export const issueWorkProductStatusSchema = z.enum(issueWorkProductStatusValues)

export const issueWorkProductReviewStateSchema = z.enum(
  issueWorkProductReviewStateValues,
)

export const connectorIdSchema = z.enum(connectorIdValues)

export const sourceKindSchema = z.enum(sourceKindValues)

export const issueRunSelectSchema = createSelectSchema(issueRun, {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  issueId: () => uuidSchema,
  agentId: () => uuidSchema,
  status: () => issueRunStatusSchema,
  contextSnapshot: () => jsonObjectSchema,
  resultJson: () => jsonObjectSchema,
  usageJson: () => jsonObjectSchema,
})

export const issueRunInsertSchema = createInsertSchema(issueRun, {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  issueId: () => uuidSchema,
  agentId: () => uuidSchema,
  status: () => issueRunStatusSchema,
  contextSnapshot: () => jsonObjectSchema,
  resultJson: () => jsonObjectSchema,
  usageJson: () => jsonObjectSchema,
})

export const issueRunUpdateSchema = createUpdateSchema(issueRun, {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  issueId: () => uuidSchema,
  agentId: () => uuidSchema,
  status: () => issueRunStatusSchema,
  contextSnapshot: () => jsonObjectSchema,
  resultJson: () => jsonObjectSchema,
  usageJson: () => jsonObjectSchema,
})

export const issueRunEventSelectSchema = createSelectSchema(issueRunEvent, {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  issueId: () => uuidSchema,
  runId: () => uuidSchema,
  eventType: () => issueRunEventTypeSchema,
  stream: () => issueRunEventStreamSchema,
  level: () => issueRunEventLevelSchema,
  payload: () => jsonObjectSchema,
})

export const issueRunEventInsertSchema = createInsertSchema(issueRunEvent, {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  issueId: () => uuidSchema,
  runId: () => uuidSchema,
  eventType: () => issueRunEventTypeSchema,
  stream: () => issueRunEventStreamSchema,
  level: () => issueRunEventLevelSchema,
  payload: () => jsonObjectSchema,
})

export const issueWorkProductSelectSchema = createSelectSchema(
  issueWorkProduct,
  {
    id: () => uuidSchema,
    workspaceId: () => uuidSchema,
    issueId: () => uuidSchema,
    runId: () => uuidSchema,
    agentId: () => uuidSchema,
    type: () => issueWorkProductTypeSchema,
    status: () => issueWorkProductStatusSchema,
    reviewState: () => issueWorkProductReviewStateSchema,
    payload: () => jsonObjectSchema,
  },
)

export const issueWorkProductInsertSchema = createInsertSchema(
  issueWorkProduct,
  {
    id: () => uuidSchema,
    workspaceId: () => uuidSchema,
    issueId: () => uuidSchema,
    runId: () => uuidSchema,
    agentId: () => uuidSchema,
    type: () => issueWorkProductTypeSchema,
    status: () => issueWorkProductStatusSchema,
    reviewState: () => issueWorkProductReviewStateSchema,
    payload: () => jsonObjectSchema,
  },
)

export const issueSourceBindingSelectSchema = createSelectSchema(
  issueSourceBinding,
  {
    id: () => uuidSchema,
    workspaceId: () => uuidSchema,
    issueId: () => uuidSchema,
    connectorId: () => connectorIdSchema,
    sourceKind: () => sourceKindSchema,
    metadata: () => jsonObjectSchema,
  },
)

export const issueSourceBindingInsertSchema = createInsertSchema(
  issueSourceBinding,
  {
    id: () => uuidSchema,
    workspaceId: () => uuidSchema,
    issueId: () => uuidSchema,
    connectorId: () => connectorIdSchema,
    sourceKind: () => sourceKindSchema,
    metadata: () => jsonObjectSchema,
  },
)

export const inboxDismissalSelectSchema = createSelectSchema(inboxDismissal, {
  id: () => uuidSchema,
  workspaceId: () => uuidSchema,
  userId: () => uuidSchema,
})
