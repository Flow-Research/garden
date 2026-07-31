# GitHub

Garden uses one Garden-owned GitHub App. A workspace installs the app on an account or organization and chooses the repositories it may access.

Each native REST tool call mints a short-lived installation access token. The hosted MCP adapter also mints a fresh installation token for each MCP session, then calls GitHub’s official `https://api.githubcopilot.com/mcp/` transport. Tokens are never persisted. GitHub repository selection and App permissions remain authoritative.
