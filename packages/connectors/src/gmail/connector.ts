import { defineConnector } from '../sdk.ts'

const gmailComposeScope = 'https://www.googleapis.com/auth/gmail.compose'
const gmailLabelsScope = 'https://www.googleapis.com/auth/gmail.labels'
const gmailModifyScope = 'https://www.googleapis.com/auth/gmail.modify'
const gmailReadonlyScope = 'https://www.googleapis.com/auth/gmail.readonly'
const gmailSendScope = 'https://www.googleapis.com/auth/gmail.send'

export default defineConnector({
  id: 'gmail',
  label: 'Gmail',
  description:
    'Search threads, manage labels, and create drafts through Google Workspace’s Gmail MCP.',
  icon: './icon.svg',
  executorSlug: 'google_gmail',
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
      gmailSendScope,
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
    'gmail.users.drafts.list': {
      riskClass: 'read',
      requiredScopes: [gmailComposeScope],
    },
    'gmail.users.drafts.get': {
      riskClass: 'read',
      requiredScopes: [gmailComposeScope],
    },
    'gmail.users.drafts.create': {
      riskClass: 'write',
      requiredScopes: [gmailComposeScope],
    },
    'gmail.users.drafts.update': {
      riskClass: 'write',
      requiredScopes: [gmailComposeScope],
    },
    'gmail.users.drafts.delete': {
      riskClass: 'write',
      requiredScopes: [gmailComposeScope],
    },
    'gmail.users.drafts.send': {
      riskClass: 'send_external',
      requiredScopes: [gmailComposeScope],
    },
    'gmail.users.messages.list': {
      riskClass: 'read',
      requiredScopes: [gmailReadonlyScope],
    },
    'gmail.users.messages.get': {
      riskClass: 'read',
      requiredScopes: [gmailReadonlyScope],
    },
    'gmail.users.messages.send': {
      riskClass: 'send_external',
      requiredScopes: [gmailSendScope],
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
