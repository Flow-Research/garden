# GitHub

Garden uses one Garden-owned GitHub App. A workspace installs the app on an account or organization and chooses the repositories it may access.

Each native REST tool call and hosted MCP session mints a short-lived
installation access token through one shared helper
(`mintGitHubInstallationAccessToken` → `createGitHubInstallationAccessToken`).
The mint refuses missing, disconnected, or degraded workspace installs before
calling GitHub (`github.install_missing` / `install_disconnected` /
`install_degraded`), then returns `token`, `expiresAt`, and `installationId`.
Tokens live only in a short-lived in-memory cache until `expires_at` minus a
small skew; they are never written to durable storage. On HTTP 401
(`github.token_rejected`), the cache entry is dropped and REST / hosted MCP
remint once and retry once; a second 401 surfaces the classified auth error
with no further loops. Private keys from Worker/env secrets are normalized
through `normalizeGitHubAppPrivateKey` (JSON quotes / `\\n`) on every mint
path. Hosted MCP then calls GitHub’s official
`https://api.githubcopilot.com/mcp/` transport. Auth failures are classified
(`github.mint_failed`, `github.token_rejected`,
`github.insufficient_permission`, etc.) with reconnect hints instead of opaque
upstream "Bad credentials". GitHub repository selection and App permissions
remain authoritative. `list_workspace_inventory` reports the real install
status (`connected` / `degraded`) from the availability query.

## Verification

With a connected install that has repository access:

1. Chat: `list my GitHub repos` → native `list_repositories` (not sandbox).
2. Force a bad/expired token path if needed → one remint, then clear
   `[github.token_rejected]` if still failing.
3. Disconnect or degrade the install → classified `install_*` refusal.
4. Sandbox `curl`/`gh` to `api.github.com` should not be the agent’s path.

## Path discipline

Agents must call GitHub only through Garden connector tools (`github.*` /
Garden-hosted `github-mcp.*`). Do not use sandbox `curl`/`gh`, invented
`GITHUB_TOKEN`/PATs, or Executor `github-rest` / `github-graphql` presets
(those presets stay disabled in `executor-engine/presets.ts`). Sandbox env
does not receive a Garden GitHub token.
