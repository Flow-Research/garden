/** Rejects pattern syntax so one authorized connection cannot widen its scope. */
export const isGardenMailExecutorConnectionName = (connectionName: string) =>
  /^[a-zA-Z0-9_-]+$/.test(connectionName)

/** Builds one exact Executor Gmail connection pattern after scope validation. */
export const gardenMailExecutorConnectionPattern = (connectionName: string) =>
  `google_gmail.user.${connectionName}.*`

/** Gmail reads that operate on the selected provider thread/account. */
export const GARDEN_MAIL_EXECUTOR_READ_TOOLS = [
  'gmail.users.getProfile',
  'gmail.users.labels.get',
  'gmail.users.labels.list',
  'gmail.users.messages.attachments.get',
  'gmail.users.messages.get',
  'gmail.users.messages.list',
  'gmail.users.threads.get',
  'gmail.users.threads.list',
] as const

/** Provider mutations stay behind Executor's explicit approval path. */
export const GARDEN_MAIL_EXECUTOR_WRITE_TOOLS = [
  'gmail.users.threads.modify',
] as const

/** Sync states whose Gmail connection can still execute provider actions. */
export const MAIL_EXECUTOR_ACTIVE_SYNC_STATUSES = [
  'connected',
  'syncing',
  'ready',
  'degraded',
] as const

export type GardenMailExecutorPolicy = {
  readonly pattern: string
  readonly action: ToolPolicyAction
}

/** Canonical first-match policy order: exact rules precede the broad block. */
export const gardenMailExecutorPolicyRules = (
  connectionNames: readonly string[],
): ReadonlyArray<GardenMailExecutorPolicy> =>
  connectionNames.flatMap((connectionName) => [
    ...GARDEN_MAIL_EXECUTOR_READ_TOOLS.map((toolName) => ({
      pattern: `google_gmail.user.${connectionName}.${toolName}`,
      action: 'approve' as const,
    })),
    ...GARDEN_MAIL_EXECUTOR_WRITE_TOOLS.map((toolName) => ({
      pattern: `google_gmail.user.${connectionName}.${toolName}`,
      action: 'require_approval' as const,
    })),
    {
      pattern: gardenMailExecutorConnectionPattern(connectionName),
      action: 'block' as const,
    },
  ])

/** Mirrors Executor toolkit policy resolution for one scoped mail tool id. */
export const resolveGardenMailExecutorPolicy = (
  toolId: string,
  connectionNames: readonly string[],
): ToolPolicyAction =>
  gardenMailExecutorPolicyRules(connectionNames).find((policy) =>
    matchPattern(policy.pattern, toolId),
  )?.action ?? 'block'

export type GardenMailApprovalTarget = {
  readonly connectionName: string
  readonly toolName: (typeof GARDEN_MAIL_EXECUTOR_WRITE_TOOLS)[number]
}

const GARDEN_GMAIL_STATE_LABELS = ['INBOX', 'UNREAD', 'STARRED'] as const
type GardenGmailStateLabel = (typeof GARDEN_GMAIL_STATE_LABELS)[number]

export type GardenMailThreadMutation = {
  readonly threadId: string
  readonly addLabelIds: readonly GardenGmailStateLabel[]
  readonly removeLabelIds: readonly GardenGmailStateLabel[]
}

/**
 * Decodes the exact Gmail thread mutation represented by Garden's actor-state
 * model. Message-level and trash operations cannot be projected honestly, and
 * unknown fields or labels could hide a broader provider mutation, so they are
 * rejected before the human approval reaches Executor.
 */
export const gardenMailThreadMutation = (
  args: unknown,
): GardenMailThreadMutation | null => {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    return null
  }
  const record = args as Record<string, unknown>
  const keys = Object.keys(record)
  if (
    keys.some(
      (key) =>
        key !== 'id' && key !== 'addLabelIds' && key !== 'removeLabelIds',
    )
  ) {
    return null
  }
  if (typeof record.id !== 'string' || record.id.trim().length === 0) {
    return null
  }
  const decodeLabels = (
    value: unknown,
  ): readonly GardenGmailStateLabel[] | null => {
    if (value === undefined) return []
    if (!Array.isArray(value)) return null
    const labels = value.filter(
      (label): label is GardenGmailStateLabel =>
        typeof label === 'string' &&
        GARDEN_GMAIL_STATE_LABELS.some((candidate) => candidate === label),
    )
    return labels.length === value.length &&
      new Set(labels).size === labels.length
      ? labels
      : null
  }
  const addLabelIds = decodeLabels(record.addLabelIds)
  const removeLabelIds = decodeLabels(record.removeLabelIds)
  if (addLabelIds === null || removeLabelIds === null) return null
  if (addLabelIds.length === 0 && removeLabelIds.length === 0) return null
  if (addLabelIds.some((label) => removeLabelIds.includes(label))) return null
  return {
    threadId: record.id,
    addLabelIds,
    removeLabelIds,
  }
}

/**
 * Decodes Executor's paused address into the exact Gmail connection and
 * reversible mutation Garden permits. Anything outside the scoped provider,
 * owner tier, or mutation allowlist is rejected before a human decision can be
 * delivered to the paused runtime.
 */
export const gardenMailApprovalTarget = (
  address: unknown,
): GardenMailApprovalTarget | null => {
  if (typeof address !== 'string') return null
  const parts = address.split('.')
  if (
    parts.length < 5 ||
    parts[0] !== 'google_gmail' ||
    parts[1] !== 'user' ||
    !isGardenMailExecutorConnectionName(parts[2] ?? '')
  ) {
    return null
  }
  const toolName = parts.slice(3).join('.')
  const allowedToolName = GARDEN_MAIL_EXECUTOR_WRITE_TOOLS.find(
    (candidate) => candidate === toolName,
  )
  return allowedToolName === undefined
    ? null
    : { connectionName: parts[2] ?? '', toolName: allowedToolName }
}
import { matchPattern, type ToolPolicyAction } from '@executor-js/sdk/core'
export { isGardenMailExecutorToolkit } from '@garden/core/mail'
