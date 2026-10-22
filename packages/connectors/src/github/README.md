# GitHub

Garden uses one Garden-owned GitHub App. A workspace installs the app on an account or organization and chooses the repositories it may access.

Each native REST tool call and hosted MCP session mints a short-lived
installation access token through one shared helper
(`mintGitHubInstallationAccessToken` → `createGitHubInstallationAccessToken`).
The mint refuses missing, disconnected, or degraded workspace installs before
calling GitHub (`github.install_missing` / `install_disconnected` /
`install_degraded`), then returns `token`, `expiresAt`, and `installationId`;
tokens are never persisted. On HTTP 401 (`github.token_rejected`), REST and
hosted MCP remint once and retry the operation once; a second 401 surfaces the
classified auth error with no further loops. Hosted MCP then calls GitHub’s
official `https://api.githubcopilot.com/mcp/` transport. Auth failures are
classified (`github.mint_failed`, `github.token_rejected`,
`github.insufficient_permission`, etc.) with reconnect hints instead of opaque
upstream "Bad credentials". GitHub repository selection and App permissions
remain authoritative. `list_workspace_inventory` reports the real install
status (`connected` / `degraded`) from the availability query.

## Path discipline

Agents must call GitHub only through Garden connector tools (`github.*` /
Garden-hosted `github-mcp.*`). Do not use sandbox `curl`/`gh`, invented
`GITHUB_TOKEN`/PATs, or Executor `github-rest` / `github-graphql` presets
(those presets stay disabled in `executor-engine/presets.ts`). Sandbox env
does not receive a Garden GitHub token.
