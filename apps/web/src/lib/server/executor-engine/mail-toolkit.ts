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
  'gmail.users.messages.modify',
  'gmail.users.messages.trash',
  'gmail.users.messages.untrash',
  'gmail.users.threads.modify',
  'gmail.users.threads.trash',
  'gmail.users.threads.untrash',
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
