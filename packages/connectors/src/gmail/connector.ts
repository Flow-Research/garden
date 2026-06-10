import { defineConnector } from '../sdk.ts'

const gmailComposeScope = 'https://www.googleapis.com/auth/gmail.compose'
const gmailLabelsScope = 'https://www.googleapis.com/auth/gmail.labels'
const gmailModifyScope = 'https://www.googleapis.com/auth/gmail.modify'
const gmailReadonlyScope = 'https://www.googleapis.com/auth/gmail.readonly'

export default defineConnector({
  id: 'gmail',
  label: 'Gmail',
  description:
    'Search threads, manage labels, and create drafts through Google Workspace’s Gmail MCP.',
  icon: './icon.svg',
  upstream: {
    mcpServerUrl: 'https://gmailmcp.googleapis.com/mcp/v1',
    transport: 'streamable-http',
  },
  oauth: {
    kind: 'oauth',
    providerId: 'gmail',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: [
      gmailReadonlyScope,
      gmailComposeScope,
      gmailLabelsScope,
      gmailModifyScope,
    ],
    apiHosts: ['gmailmcp.googleapis.com', 'gmail.googleapis.com'],
  },
  tools: {
    create_draft: {
      riskClass: 'write',
      requiredScopes: [gmailComposeScope],
    },
    create_label: {
      riskClass: 'write',
      requiredScopes: [gmailLabelsScope],
    },
    get_thread: {
      riskClass: 'read',
      requiredScopes: [gmailReadonlyScope],
    },
    label_message: {
      riskClass: 'write',
      requiredScopes: [gmailModifyScope],
    },
    label_thread: {
      riskClass: 'write',
      requiredScopes: [gmailModifyScope],
    },
    list_drafts: {
      riskClass: 'read',
      requiredScopes: [gmailComposeScope],
    },
    list_labels: {
      riskClass: 'read',
      requiredScopes: [gmailLabelsScope],
    },
    search_threads: {
      riskClass: 'read',
      requiredScopes: [gmailReadonlyScope],
    },
    unlabel_message: {
      riskClass: 'write',
      requiredScopes: [gmailModifyScope],
    },
    unlabel_thread: {
      riskClass: 'write',
      requiredScopes: [gmailModifyScope],
    },
  },
})
