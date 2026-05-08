export const automationStatusValues = ['active', 'paused', 'archived'] as const
export const automationExecutionModeValues = [
  'create_issue',
  'run_only',
] as const
export const automationConcurrencyPolicyValues = [
  'skip',
  'queue',
  'replace',
] as const
export const automationTriggerKindValues = [
  'schedule',
  'webhook',
  'api',
] as const
export const automationRunSourceValues = [
  'schedule',
  'manual',
  'webhook',
  'api',
] as const
export const automationRunStatusValues = [
  'pending',
  'issue_created',
  'running',
  'completed',
  'failed',
  'skipped',
] as const
