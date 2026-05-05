# Connectors

## Gaps

| Gap                                                                                                                                                                                                                                            | Source                                                                                                                                                                  | Severity             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Capability catalog sync from upstream `tools/list` not automated                                                                                                                                                                               | Implementation plan Phase 5                                                                                                                                             | Medium               |
| Connector audit UI / "Recent activity" drawer not built                                                                                                                                                                                        | Implementation plan Phase 11                                                                                                                                            | Medium               |
| MCP runtime session state is split between Postgres truth and per-DO warm cache; archive/delete cleanup is now guarded, but connector sessions need a clearer single-source-of-truth model                                                     | `packages/agent-runtime/src/runtime-mcp-controller.ts`, `packages/agent-runtime/src/agent-do.ts`                                                                        | Medium               |
| Capability awareness is not unified across MCP tools, permission grants, workspace inventory, and agent proposal. Runtime tools can be callable while inventory/proposal still reports only skills unless connectors are explicitly requested. | `packages/agent-runtime/src/runtime-mcp-controller.ts`, `packages/agent-runtime/src/chat-sub-agent-tools.ts`, `packages/agent-runtime/src/agent-tools/propose-agent.ts` | High                 |
| `GITHUB_TOKEN` not plumbed for skills.sh import API headroom                                                                                                                                                                                   | `apps/web/src/lib/server/skills-sh.ts:7`                                                                                                                                | Low                  |
| Contributor CLI scaffolds tools with `TODO: classify` stubs                                                                                                                                                                                    | `packages/create-garden-connector/src/upstream-tools.ts:104`                                                                                                            | By design (scaffold) |

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

## Accepted Costs

| Item                                                                           | Source                              |
| ------------------------------------------------------------------------------ | ----------------------------------- |
| Context bloat from loading all tool schemas per turn — accepted until it hurts | `docs/core/connectors.md`           |
| Code Mode (sandbox execution escape hatch) documented but not built            | `docs/core/connectors.md`           |
| MCP Elicitation (mid-call prompts) not supported                               | `docs/core/connectors.md` non-goals |

## Session State Notes

- Postgres is the authority for connector accounts, capability grants, agents, chat threads, and issue runs.
- Durable Object state should be treated as warm cache: registered MCP servers, minted proxy JWTs, tool signatures, and refresh schedules.
- Delete should destroy runtime cache for the thread. Archive should only pause background refresh and live connector registrations so unarchive can rebuild cheaply.
- The current code has a defensive orphan guard for missing chat threads and pauses archived chat runtimes, but a broader cleanup pass is still needed for agent archive, issue-run terminal states, and workspace deletion.

## Code TODOs

```
apps/web/src/lib/server/skills-sh.ts:7
  // TODO(skills): add a `GITHUB_TOKEN` worker secret/binding and plumb it through
  // the import path for higher GitHub API headroom.

packages/create-garden-connector/src/upstream-tools.ts:104
  '      // TODO: classify this tool honestly before shipping.',
```
