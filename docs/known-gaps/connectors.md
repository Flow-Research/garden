# Connectors

## Gaps

| Gap                                                                                                                                                                                                                                            | Source                                                                                                                                                                  | Severity             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Capability catalog sync is event-driven, not periodic. It runs on OAuth callback, connection action, GitHub setup, and the internal sync endpoint, but there is no scheduled drift check against upstream `tools/list`. | `apps/web/src/lib/server/capability-sync.ts`, `apps/web/src/lib/auth/instance.ts`, `apps/web/src/routes/api/connections/$connectorId.ts` | Medium |
| Connector audit UI / "Recent activity" drawer not built                                                                                                                                                                                        | Implementation plan Phase 11                                                                                                                                            | Medium               |
| MCP runtime session state is split between Postgres truth and per-DO warm cache; archive/delete cleanup is now guarded, but connector sessions need a clearer single-source-of-truth model                                                     | `packages/agent-runtime/src/runtime-mcp-controller.ts`, `packages/agent-runtime/src/agent-do.ts`                                                                        | Medium               |
| MCP proxy hardening: HTTP auth validates agent/workspace but not explicit user membership, approval reuse is scoped by agent+capability+args but not issue/run, audit failures do not fail closed for risky tools, and GitHub App calls rely on upstream repo-selection enforcement. | `workers/mcp-proxy/src/auth.ts`, `workers/mcp-proxy/src/permission.ts`, `workers/mcp-proxy/src/session.ts`, `workers/mcp-proxy/src/audit.ts` | Medium               |
| Capability awareness is not unified across MCP tools, permission grants, workspace inventory, and agent proposal. `propose_agent` can capture `connector_requirements`, but approval does not turn those requirements into first-class permission grants. | `packages/agent-runtime/src/runtime-mcp-controller.ts`, `packages/agent-runtime/src/chat-sub-agent-tools.ts`, `packages/agent-runtime/src/agent-tools/propose-agent.ts` | High                 |
| `GITHUB_TOKEN` not plumbed for skills.sh import API headroom                                                                                                                                                                                   | `apps/web/src/lib/server/skills-sh.ts:7`                                                                                                                                | Low                  |
| Exa search should be a built-in agent tool, not an MCP connector — web search is a first-class agent capability, not an integration; routing it through the connector system is wrong abstraction                                               | `connectors/exa-search/`                                                                                                                                                | Medium               |

## Done

| Item                                                        | Evidence                                                                                                                                      |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 5 connector manifests                                       | `connectors/github/`, `connectors/gmail/`, `connectors/google-drive/`, `connectors/slack/`, `connectors/exa-search/` each with `connector.ts` |
| MCP proxy Worker                                            | `workers/mcp-proxy/src/` — `index.ts`, `auth.ts`, `permission.ts`, `session.ts`, `audit.ts`                                                   |
| OAuth connect flow via Better Auth `genericOAuth`           | `connectors/oauth.ts` + `workers/mcp-proxy/src/auth.ts`                                                                                       |
| Agent runtime consumes MCP tools                            | `packages/agent-runtime/src/runtime-mcp-controller.ts` — `McpClientFacade`, `getAITools()`                                                    |
| HITL approval flow (Agents SDK `needsApproval`)             | `packages/agent-runtime/src/runtime-mcp-controller.ts` — `needsApproval()` wrapping, `ensureMcpToolNeedsApproval()`                           |
| Permission management UI (segmented Auto/Allow/Ask toggles) | `apps/web/src/features/connections/components/connections-page.tsx` lines 718-720                                                             |
| `tool_call_audit` table                                     | `packages/db/src/schema/audit.ts` — toolCallId, resultStatus, durationMs                                                                      |
| `capability` table with risk classes                        | `packages/db/src/schema/capabilities.ts` — connectorType, riskClass, requiredScopes, inputSchema                                              |
| `permissionGrant` table (auto/allow/ask)                    | `packages/db/src/schema/capabilities.ts`                                                                                                      |
| `permissionRequest` table                                   | `packages/db/src/schema/capabilities.ts`                                                                                                      |
| Connector registry                                          | `connectors/registry.ts` — 5 connectors with OAuth/API-key support                                                                            |
| Connector CI workflow                                       | `.github/workflows/connectors.yml`                                                                                                            |
| Stable MCP server ids for connectors                        | `agents@0.14.5` adds `id` to `addMcpServer()` / `addRpcMcpServer()`; Garden now passes `id: connector.id` and treats MCP server ids as connector ids. |
| Analytics Engine connector counters                         | `workers/mcp-proxy/wrangler.jsonc` binds `CONNECTOR_CALLS`; `workers/mcp-proxy/src/audit.ts` writes datapoints per connector/tool/status. |

## Accepted Costs

| Item                                                                           | Source                              |
| ------------------------------------------------------------------------------ | ----------------------------------- |
| Context bloat from loading all tool schemas per turn — accepted until it hurts | `docs/core/connectors.md`           |
| Connector tools inside Code Mode are not exposed by default; codemode itself is built through `createExecuteTool` | `docs/core/connectors.md`, `packages/agent-runtime/src/chat-sub-agent-tools.ts` |
| MCP Elicitation (mid-call prompts) not supported                               | `docs/core/connectors.md` non-goals |

## Session State Notes

- Postgres is the authority for connector accounts, capability grants, agents, chat threads, and issue runs.
- Durable Object state should be treated as warm cache: registered MCP servers, session props, and tool signatures.
- Delete should destroy runtime cache for the thread. Archive should only pause background refresh and live connector registrations so unarchive can rebuild cheaply.
- The current code has a defensive orphan guard for missing chat threads and pauses archived chat runtimes, but a broader cleanup pass is still needed for agent archive, issue-run terminal states, and workspace deletion.
- Agents SDK owns RPC MCP response routing for overlapping calls (`cloudflare/agents#1558`, shipped in `agents@0.14.5`), so Garden does not serialize `handleMcpMessage()` in the proxy.
- Agents SDK owns MCP connection lifecycle. Garden should prefer `addMcpServer()` / `removeMcpServer()` / `waitForConnections()`. New registrations pass stable connector ids through the SDK `id` option and runtime lookup is strict on connector ids.

## Code TODOs

```
apps/web/src/lib/server/skills-sh.ts:7
  // TODO(skills): add a `GITHUB_TOKEN` worker secret/binding and plumb it through
  // the import path for higher GitHub API headroom.
```
