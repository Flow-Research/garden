import { defineConnector } from '../sdk.ts'

const repoScope = ['repo']
const repoAndOrgScopes = ['repo', 'read:org']

export default defineConnector({
  id: 'github',
  label: 'GitHub',
  description:
    'Read issues and pull requests, then write reviews and updates back through GitHub’s hosted MCP.',
  icon: './icon.svg',
  upstream: {
    mcpServerUrl: 'https://api.githubcopilot.com/mcp/',
    transport: 'streamable-http',
    headers: {
      'X-MCP-Toolsets': 'repos,issues,pull_requests',
    },
  },
  oauth: {
    kind: 'oauth',
    providerId: 'github',
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scopes: repoAndOrgScopes,
    apiHosts: ['api.githubcopilot.com', 'api.github.com'],
  },
  tools: {
    create_branch: {
      riskClass: 'write',
      requiredScopes: repoScope,
    },
    create_or_update_file: {
      riskClass: 'send_external',
      requiredScopes: repoScope,
    },
    create_repository: {
      riskClass: 'send_external',
      requiredScopes: repoScope,
    },
    delete_file: {
      riskClass: 'destructive',
      requiredScopes: repoScope,
    },
    fork_repository: {
      riskClass: 'write',
      requiredScopes: repoScope,
    },
    get_commit: {
      riskClass: 'read',
      requiredScopes: repoScope,
    },
    get_file_contents: {
      riskClass: 'read',
      requiredScopes: repoScope,
    },
    get_latest_release: {
      riskClass: 'read',
      requiredScopes: repoScope,
    },
    get_release_by_tag: {
      riskClass: 'read',
      requiredScopes: repoScope,
    },
    get_tag: {
      riskClass: 'read',
      requiredScopes: repoScope,
    },
    add_comment_to_pending_review: {
      riskClass: 'send_external',
      requiredScopes: repoScope,
    },
    add_issue_comment: {
      riskClass: 'send_external',
      requiredScopes: repoScope,
    },
    add_reply_to_pull_request_comment: {
      riskClass: 'send_external',
      requiredScopes: repoScope,
    },
    create_pull_request: {
      riskClass: 'send_external',
      requiredScopes: repoScope,
    },
    get_label: {
      riskClass: 'read',
      requiredScopes: repoScope,
    },
    issue_read: {
      riskClass: 'read',
      requiredScopes: repoScope,
    },
    issue_write: {
      riskClass: 'send_external',
      requiredScopes: repoScope,
    },
    list_issue_types: {
      riskClass: 'read',
      requiredScopes: ['read:org'],
    },
    list_branches: {
      riskClass: 'read',
      requiredScopes: repoScope,
    },
    list_commits: {
      riskClass: 'read',
      requiredScopes: repoScope,
    },
    list_issues: {
      riskClass: 'read',
      requiredScopes: repoScope,
    },
    list_pull_requests: {
      riskClass: 'read',
      requiredScopes: repoScope,
    },
    list_releases: {
      riskClass: 'read',
      requiredScopes: repoScope,
    },
    list_tags: {
      riskClass: 'read',
      requiredScopes: repoScope,
    },
    merge_pull_request: {
      riskClass: 'destructive',
      requiredScopes: repoScope,
    },
    pull_request_read: {
      riskClass: 'read',
      requiredScopes: repoScope,
    },
    pull_request_review_write: {
      riskClass: 'send_external',
      requiredScopes: repoScope,
    },
    push_files: {
      riskClass: 'send_external',
      requiredScopes: repoScope,
    },
    search_code: {
      riskClass: 'read',
      requiredScopes: repoScope,
    },
    search_issues: {
      riskClass: 'read',
      requiredScopes: repoScope,
    },
    search_pull_requests: {
      riskClass: 'read',
      requiredScopes: repoScope,
    },
    search_repositories: {
      riskClass: 'read',
      requiredScopes: repoScope,
    },
    sub_issue_write: {
      riskClass: 'write',
      requiredScopes: repoScope,
    },
    update_pull_request: {
      riskClass: 'send_external',
      requiredScopes: repoScope,
    },
    update_pull_request_branch: {
      riskClass: 'write',
      requiredScopes: repoScope,
    },
  },
})
