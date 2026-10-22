# GitHub

Garden uses one Garden-owned GitHub App. A workspace installs the app on an account or organization and chooses the repositories it may access.

Each native REST tool call and hosted MCP session mints a short-lived
installation access token through one shared helper
(`mintGitHubInstallationAccessToken` → `createGitHubInstallationAccessToken`).
The mint returns `token`, `expiresAt`, and `installationId`; tokens are never
persisted. Hosted MCP then calls GitHub’s official
`https://api.githubcopilot.com/mcp/` transport. Auth failures are classified
(`github.mint_failed`, `github.token_rejected`, `github.insufficient_permission`,
etc.) with reconnect hints instead of opaque upstream "Bad credentials".
GitHub repository selection and App permissions remain authoritative.
