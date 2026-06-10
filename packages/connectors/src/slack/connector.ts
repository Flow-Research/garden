import { defineConnector } from '../sdk.ts'

const slackCanvasScopes = ['canvases:read', 'canvases:write']
const slackHistoryScopes = [
  'channels:history',
  'groups:history',
  'mpim:history',
  'im:history',
]
const slackSearchPublicScopes = ['search:read.public']
const slackSearchWorkspaceScopes = [
  'search:read.public',
  'search:read.private',
  'search:read.mpim',
  'search:read.im',
]
const slackUserProfileScopes = ['users:read', 'users:read.email']

export default defineConnector({
  id: 'slack',
  label: 'Slack',
  description:
    'Search channels and people, read thread context, draft messages, and publish updates via Slack’s MCP.',
  icon: './icon.svg',
  upstream: {
    mcpServerUrl: 'https://mcp.slack.com/mcp',
    transport: 'streamable-http',
  },
  oauth: {
    kind: 'oauth',
    providerId: 'slack',
    authUrl: 'https://slack.com/oauth/v2_user/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.user.access',
    scopes: [
      ...slackSearchWorkspaceScopes,
      'search:read.files',
      'search:read.users',
      'chat:write',
      ...slackHistoryScopes,
      ...slackCanvasScopes,
      ...slackUserProfileScopes,
    ],
    apiHosts: ['mcp.slack.com', 'slack.com'],
  },
  tools: {
    slack_create_canvas: {
      riskClass: 'send_external',
      requiredScopes: slackCanvasScopes,
    },
    slack_read_channel: {
      riskClass: 'read',
      requiredScopes: slackHistoryScopes,
    },
    slack_read_thread: {
      riskClass: 'read',
      requiredScopes: slackHistoryScopes,
    },
    slack_read_user_profile: {
      riskClass: 'read',
      requiredScopes: slackUserProfileScopes,
    },
    slack_search_channels: {
      riskClass: 'read',
      requiredScopes: slackSearchWorkspaceScopes,
    },
    slack_search_public: {
      riskClass: 'read',
      requiredScopes: slackSearchPublicScopes,
    },
    slack_search_public_and_private: {
      riskClass: 'read',
      requiredScopes: slackSearchWorkspaceScopes,
    },
    slack_search_users: {
      riskClass: 'read',
      requiredScopes: ['search:read.users'],
    },
    slack_send_message: {
      riskClass: 'send_external',
      requiredScopes: ['chat:write'],
    },
    slack_send_message_draft: {
      riskClass: 'write',
      requiredScopes: ['chat:write'],
    },
  },
})
