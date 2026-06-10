# Codemode + Permissions Plan

**Status:** current architecture note + remaining direction
**Last reviewed:** 2026-05-24

Codemode, container sandbox tools, MCP connector tools, and permission approvals must share one product policy story. This doc is code-aligned; old PRD trust-ladder terms are historical product language, not current schema/runtime names.

## Current code map

| Concern | Evidence |
| --- | --- |
| Runtime MCP tool wrapping and approval integration | `packages/agent-runtime/src/runtime-mcp-controller.ts` |
| MCP proxy permission decision/audit | `workers/mcp-proxy/src/permission.ts`, `session.ts`, `audit.ts` |
| Capability/grant/request tables | `packages/db/src/schema/capabilities.ts` |
| Agent permissions object | `packages/core/agents/permissions.ts` |
| Connector registry/manifests | `packages/connectors/src/registry.ts`, `connectors/*/connector.ts` |
| Connections UI toggles | `apps/web/src/features/connections/components/connections-page.tsx` |
| Codemode execute | `createExecuteTool` usage in `packages/agent-runtime/src/chat-sub-agent-tools.ts` and automation runtime |
| Container sandbox tools | `packages/agent-runtime/src/sandbox-tools.ts`, `apps/web/wrangler.jsonc` `Sandbox` binding |
| Runtime sandbox gap analysis | `docs/known-gaps/runtime-sandbox-codemode.md` |

## Current permission vocabulary

Runtime/storage trust levels are:

- `auto`
- `allow`
- `ask`

Risk classes are:

- `read`
- `write`
- `send_external`
- `destructive`

Code evidence: `packages/db/src/schema/capabilities.ts`, `connectors/capabilities.ts`, `workers/mcp-proxy/src/permission.ts`.

Do not model current code as `ask_always`, `ask_on_risky`, or `never_ask`. If product later wants a higher-level connector posture knob, it should compile down to per-capability `auto | allow | ask` rows and be documented as product UI, not schema truth.

## Codemode vs container sandbox

Garden has two execution surfaces:

| Surface | Runtime | Best for | Storage |
| --- | --- | --- | --- |
| Codemode `execute` | `@cloudflare/codemode` / Dynamic Worker via `LOADER` | bounded JavaScript orchestration, multi-step file/tool planning | Think/Shell `Workspace` state providers |
| Container sandbox tools | `@cloudflare/sandbox` container | shell, native binaries, package installs, previews, long-running processes | container `/workspace` |

They do not share files today. See `docs/known-gaps/runtime-sandbox-codemode.md`.

## Policy direction

The product goal remains: approval behavior should not depend on whether a tool call came directly from the model, from codemode, or from the MCP proxy. The code is not fully unified yet.

Target shape:

1. classify every callable local/MCP tool with a risk class;
2. use one shared policy decision module for runtime, proxy, UI inspection, and tests;
3. keep proxy enforcement as defense-in-depth because the proxy owns upstream tokens;
4. expose only tools whose effective policy is safe for the execution surface;
5. audit every tool call, including inner/orchestrated calls.

## Current gaps

| Gap | Notes |
| --- | --- |
| Local tools are not fully modeled as capability rows. | `sandbox*`, document, workspace, and Garden-domain tools need the same risk inventory if they are to participate in a single policy UI. |
| Codemode inner calls cannot rely on AI SDK `needsApproval`. | Inner calls do not appear as normal outer model tool calls. Approval-required tools should be excluded from codemode or gated by a dispatch layer. |
| Runtime and proxy policy code are not a single shared package. | Proxy has the authoritative token boundary; runtime should avoid drifting logic. |
| Per-agent connector capability assignment during agent proposal/setup is incomplete. | See `docs/known-gaps/agent-runtime.md` and `docs/known-gaps/connectors.md`. |
| Audit UI is not built. | `tool_call_audit` exists, but product surfacing is still a gap. |

## Rules for future implementation

- Keep schema/runtime names `auto | allow | ask`.
- Keep destructive tools impossible to silently auto-run unless code explicitly proves a safe exception.
- Do not hide approval-required behavior inside codemode.
- Prefer direct outer tools for actions that may pause for approval.
- Keep connector token injection inside the MCP proxy; agent DOs should not see upstream tokens.
- Use `better-result` for new TypeScript error handling.
