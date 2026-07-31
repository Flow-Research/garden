import type { ConnectorToolClassification } from '../sdk.ts'

/**
 * Security metadata for official hosted-MCP operations that do not have a
 * native REST adapter. Names are retained only when GitHub publishes them in
 * the live MCP manifest; the runtime never fabricates a tool from this map.
 */
export const githubHostedMcpExtraClassifications = {
  actions_get: {
    riskClass: 'read',
    requiredScopes: ['actions:read'],
  },
  actions_list: {
    riskClass: 'read',
    requiredScopes: ['actions:read'],
  },
  actions_run_trigger: {
    riskClass: 'send_external',
    requiredScopes: ['actions:write'],
  },
  add_comment_to_pending_review: {
    riskClass: 'send_external',
    requiredScopes: ['pull_requests:write'],
  },
  create_repository: {
    riskClass: 'send_external',
    requiredScopes: ['administration:write'],
  },
  get_job_logs: {
    riskClass: 'read',
    requiredScopes: ['actions:read'],
  },
  list_issue_fields: {
    riskClass: 'read',
    requiredScopes: ['issues:read'],
  },
  list_issue_types: {
    riskClass: 'read',
    requiredScopes: ['organization:read'],
  },
  push_files: {
    riskClass: 'send_external',
    requiredScopes: ['contents:write'],
  },
} as const satisfies Record<string, ConnectorToolClassification>
