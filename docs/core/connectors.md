# Connectors

How Garden exposes external tools to agents via MCP, and how contributors add new ones.

---

## Model

A connector is an **adapter over an official upstream MCP server** (e.g. GitHub's `github-mcp-server`, Notion's MCP server, etc.). Garden does not re-implement upstream APIs. Each connector manifest declares:

- **Which official MCP server to front**
- **OAuth scopes Garden will request** on the user's behalf
- **Risk class + required scopes per tool name** (reconciled against the upstream's `tools/list` at sync time)

Our runtime does three things on top of the upstream MCP:
1. **Auth** — Garden handles OAuth in the web UI via Better Auth and injects the upstream token into every MCP call.
2. **Permissions** — Garden enforces per-tool `auto/allow/ask` grants and human-in-the-loop approval via the Cloudflare Agents SDK `needsApproval` primitive.
3. **Audit** — every call logs to `tool_call_audit`.

### Hard rules

- **Official MCP servers only.** If no official upstream exists, the connector is not supported — period. No inline tool implementations. No fallback paths.
- **No token passthrough.** The agent DO never sees upstream tokens. The proxy injects them per-call.
- **No fallbacks for missing/unclassified tools.** If the upstream's `tools/list` returns a tool not classified in the manifest, CI fails and sync is blocked until a human adds the classification.

### Tiers (deferred)

Tier 2 (full custom `McpAgent` Worker per connector) is not implemented. It's the escape hatch we build when a real connector forces the issue. Don't pre-build it.

## Context bloat (v1 policy)

We ship with the bloat. A workspace with many connectors loads all their tool schemas into context each turn. We accept this until it hurts.

**Later, when it hurts:** Code Mode is the planned escape hatch — a single `execute(code)` tool; upstream MCPs compiled into typed TypeScript wrappers; model writes code that calls them; code runs in a sandboxed V8 isolate (Cloudflare Worker Loader API). Documented here, not built now.

**Not using:** Anthropic's server-side Tool Search (paid API feature). Vector tool routers (extra infra we don't need yet).

## Storage

Better Auth's `account` table stores upstream OAuth tokens (`encryptOAuthTokens: true`, `updateAccountOnSignIn: true`). One account row per `(user, providerId)`. The old `connector_connection` table is removed.

- `capability` — synced from each connector's upstream `tools/list`, keyed by `(connector_type, tool_name)`, includes `schema_hash` + `required_scopes` + `risk_class`.
- `permission_grant` — per `(agent_id, capability_id)` trust level: `auto | allow | ask`.
- `permission_request` — pending approval queue; powers inbox + in-chat approval UI.
- `tool_call_audit` — every tool call (including auto-allowed) for compliance and the "Recent activity" UI.

Distinct `providerId` per connector (e.g. `"github"`, `"slack"`, `"notion"`). If a user needs two Slack workspaces, distinct providerIds (`"slack-acme"`, `"slack-beta"`) — Better Auth issue #2327.

## Approval flow

Each tool's `riskClass` (`read` | `write` | `send_external` | `destructive`) is declared in the manifest. `permission_grant.trust_level` per `(agent, capability)` decides what happens:

- `auto` — only valid for `read`; proceed silently.
- `allow` — proceed, log to audit.
- `ask` — throw structured `NeedsApproval`; Cloudflare Agents SDK `needsApproval` primitive surfaces the request in chat and inbox; user approves or denies; agent resumes via `addToolApprovalResponse`.

Defaults by risk class: `read → auto`, `write → allow`, `send_external → ask`, `destructive → ask` (always, cannot be set to `auto`).

## Contributing a connector

1. `pnpm create garden-connector <id>` — scaffolds `connectors/<id>/`.
2. Fill in `connector.ts`:
   ```ts
   export default defineConnector({
     id: 'notion',
     label: 'Notion',
     icon: './icon.svg',
     upstream: {
       // URL or package reference to the official MCP server
       mcpServerUrl: 'https://mcp.notion.com/mcp',
       // or: command/args for a Worker-deployable stdio-over-HTTP shim
     },
     oauth: {
       providerId: 'notion',        // distinct per connector
       authUrl: 'https://api.notion.com/v1/oauth/authorize',
       tokenUrl: 'https://api.notion.com/v1/oauth/token',
       scopes: ['read_content', 'update_content'],
     },
     // Risk classification per upstream tool. Must cover every tool
     // returned by the upstream's tools/list — CI fails otherwise.
     tools: {
       'search_pages':    { riskClass: 'read',           requiredScopes: ['read_content']   },
       'create_page':     { riskClass: 'write',          requiredScopes: ['update_content'] },
       'delete_page':     { riskClass: 'destructive',    requiredScopes: ['update_content'] },
     },
   })
   ```
3. `pnpm dev` — connector registers locally; connect with your own OAuth dev app.
4. PR. CI enforces the review checklist.

### Review checklist

- [ ] `upstream.mcpServerUrl` points at an **official** MCP server, not a fork.
- [ ] Every tool returned by upstream `tools/list` is classified in `tools`. No extras, no missing.
- [ ] `riskClass` is honest (`send_external` for anything hitting an external human, `destructive` for irreversible writes).
- [ ] `oauth.scopes` are minimal and justify each tool's `requiredScopes`.
- [ ] `oauth.providerId` is distinct from every existing connector.
- [ ] No credentials or PII logged.

## Non-goals (v1)

- Inline tool implementations.
- Tier 2 full custom Workers.
- MCP Elicitation (mid-call server→client prompts).
- Anthropic Tool Search.
- Code Mode (documented future escape hatch, not built).
- Vector/semantic tool routers.
- Public connector marketplace beyond the `connectors/` directory.
- Token passthrough.
- Better Auth Agent Auth plugin (beta).
