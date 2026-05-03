# Connectors

## Gaps

| Gap | Source | Severity |
|-----|--------|----------|
| Capability catalog sync from upstream `tools/list` not automated | Implementation plan Phase 5 | Medium |
| Connector audit UI / "Recent activity" drawer not built | Implementation plan Phase 11 | Medium |
| `GITHUB_TOKEN` not plumbed for skills.sh import API headroom | `apps/web/src/lib/server/skills-sh.ts:7` | Low |
| Contributor CLI scaffolds tools with `TODO: classify` stubs | `packages/create-garden-connector/src/upstream-tools.ts:104` | By design (scaffold) |

## Done

| Item | Evidence |
|------|----------|
| 5 connector manifests | `connectors/github/`, `connectors/gmail/`, `connectors/google-drive/`, `connectors/slack/`, `connectors/exa-search/` each with `connector.ts` |
| MCP proxy Worker | `workers/mcp-proxy/src/` — `index.ts`, `auth.ts`, `permission.ts`, `session.ts`, `audit.ts` |
| OAuth connect flow via Better Auth `genericOAuth` | `connectors/oauth.ts` + `workers/mcp-proxy/src/auth.ts` |
| Agent runtime consumes MCP tools | `packages/agent-runtime/src/primary-agent-mcp.ts` — `McpClientFacade`, `getAITools()` |
| HITL approval flow (Agents SDK `needsApproval`) | `packages/agent-runtime/src/primary-agent-mcp.ts` — `needsApproval()` wrapping, `ensureMcpToolNeedsApproval()` |
| Permission management UI (segmented Auto/Allow/Ask toggles) | `apps/web/src/features/connections/components/connections-page.tsx` lines 718-720 |
| `tool_call_audit` table | `packages/db/src/schema/audit.ts` — toolCallId, resultStatus, durationMs |
| `capability` table with risk classes | `packages/db/src/schema/capabilities.ts` — connectorType, riskClass, requiredScopes, inputSchema |
| `permissionGrant` table (auto/allow/ask) | `packages/db/src/schema/capabilities.ts` |
| `permissionRequest` table | `packages/db/src/schema/capabilities.ts` |
| Connector registry | `connectors/registry.ts` — 5 connectors with OAuth/API-key support |
| Connector CI workflow | `.github/workflows/connectors.yml` |

## Accepted Costs

| Item | Source |
|------|--------|
| Context bloat from loading all tool schemas per turn — accepted until it hurts | `docs/core/connectors.md` |
| Code Mode (sandbox execution escape hatch) documented but not built | `docs/core/connectors.md` |
| MCP Elicitation (mid-call prompts) not supported | `docs/core/connectors.md` non-goals |

## Code TODOs

```
apps/web/src/lib/server/skills-sh.ts:7
  // TODO(skills): add a `GITHUB_TOKEN` worker secret/binding and plumb it through
  // the import path for higher GitHub API headroom.

packages/create-garden-connector/src/upstream-tools.ts:104
  '      // TODO: classify this tool honestly before shipping.',
```
