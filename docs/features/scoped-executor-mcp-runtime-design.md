# Scoped Executor MCP runtime

Status: implementing phase 1

Owner: Garden runtime and connector integration

## Decision

Keep the current in-process Executor v1 integration. Scope each Executor MCP
Durable Object by Garden runtime identity. Keep `executor` as the local Garden
MCP server id, but use a separate scoped name for the remote RPC Durable Object.

Use one Decide execution path while this work lands. The existing direct Decide
adapter remains the temporary canonical path because the nested Executor MCP
route is unreliable. Do not start an Executor v2 migration in this change.

## Problem

Garden currently registers the Executor MCP server with the same name for every
agent runtime:

```text
Agent runtime -> addMcpServer("executor") -> rpc:executor -> one DO
```

The Agents SDK resolves an RPC MCP server by its remote name. PartyServer maps
that name to a Durable Object id. The first Executor session initializes the DO with
its workspace and user props. Later calls can reach the same initialized
Executor runtime with different props, but the runtime is not rebuilt.

This can mix workspace identity, user identity, connection state, pending MCP
requests, and direct Decide sessions. It also makes a transport timeout appear
as a provider failure when the underlying work continues.

The current timeout boundaries are also inconsistent:

```text
Agents RPC server: 4 minutes 30 seconds
Direct Decide MCP: 5 minutes
```

The outer RPC can therefore fail before the Decide call finishes.

## Goals

- Give every Executor runtime an explicit and stable scope.
- Preserve the local `executor` server id and existing Garden tool keys.
- Rebind old `rpc:executor` registrations to the new scoped name.
- Keep workspace and member identity inside the Executor session boundary.
- Make the transport path visible in tests and logs.
- Establish a design that can later use Executor v2 behind the same boundary.

## Non-goals

- Upgrade Executor packages or migrate to Executor v2.
- Redesign Garden-native GitHub or Discord tools.
- Add a connector Worker or MCP proxy Worker.
- Add a second retry or recovery system.
- Move purchase or attribution logic into MCP connector execution.
- Solve long-running Decide workflow orchestration in phase 1.

## Runtime identity

The runtime scope uses opaque Garden identifiers:

```text
executor:<workspaceId>:<userId>:<agentId>:<threadId>:<issueId|chat>:<runId|session>
```

The scope rules are:

- Chat runtimes use workspace, member, agent, and thread identity.
- Issue and automation runtimes also include the issue or run identity.
- The local MCP server id remains `executor`.
- The remote RPC name carries the scope.
- A runtime must remove an old registration when its stored remote name does
  not match the current scope.

The remote name is an addressing key. It is not an authorization boundary by
itself. Garden still resolves identity from product state and passes that
identity to Executor. Garden must continue to enforce permissions at the API
and tool boundaries.

## Ownership model

| Responsibility | Owner |
| --- | --- |
| Workspace and member identity | Garden Postgres and runtime identity resolver |
| Product permissions and grants | Garden |
| Approval requests and audit | Garden |
| Provider catalog and OAuth connections | Executor |
| Encrypted provider credentials | Executor |
| Remote MCP, OpenAPI, and GraphQL execution | Executor |
| Garden-native GitHub and Discord execution | Garden Effect services |
| MCP session warm state | Scoped Executor MCP Durable Object |
| Long-running issue and automation runs | Cloudflare Workflows |

Garden may project Executor catalog data into its capability tables. Runtime
connection state must still come from the system that owns the connection.

## Request flow

```text
AgentDO or run sub-agent
  |
  | resolve workspace, user, agent, thread, and optional run identity
  v
RuntimeMcpController
  |
  | local id = executor
  | remote name = scoped executor:<identity> name
  v
Agents RPC client
  |
  | rpc:<scoped name>
  v
ExecutorMcpSession Durable Object
  |
  | initialize once for this scope
  v
Executor v1 MCP server
  |
  +-- hosted connector tools
  +-- direct Decide adapter during phase 1
```

The controller owns the mapping from product identity to remote runtime name.
The Agent classes only adapt that name to `addMcpServer()`. This keeps the
scope rule in one place.

## Decide path

During phase 1, Decide uses the direct adapter in
`apps/web/src/lib/server/executor-engine/direct-decide-mcp.ts`.

The adapter must:

- resolve the connection through Executor;
- reuse one official MCP client per connection;
- preserve progress and structured results;
- evict a session after a failed call or disconnect;
- return typed provider and transport failures;
- avoid automatic retries for analysis calls.

The nested Executor MCP route remains available for comparison tests, but it
must not be selected as a production fallback for the same Decide call. Two
production paths make failures and billing behavior difficult to reason about.

## Timeout and long-running work

Phase 1 keeps the existing bounded synchronous call and records the current
mismatch: the direct Decide client allows five minutes while the outer RPC
allows four minutes and thirty seconds. This must be resolved before relying
on the synchronous path for longer analysis.

If Decide's four-minute documented limit is the provider contract, set the
provider deadline to four minutes and keep a measured response margin outside
that deadline. If the provider can run longer, move the work to a Workflow
instead of extending nested RPC timeouts.

If Decide analysis must run longer than the request boundary, the next phase
will introduce a Workflow run with an id, progress state, cancellation, and
resume behavior. It must not add a manual transcript recovery loop or a second
timeout system.

## Rollout

### Phase 1, scoped runtime

1. Build a scoped remote Executor MCP name from `ThreadRuntimeIdentity`.
2. Pass the scoped name to both Agent host adapters.
3. Preserve local id `executor`.
4. Remove an old global or mismatched registration before adding the scoped one.
5. Add unit coverage for stable names and different identities.
6. Add a real Durable Object integration test for two identities.

### Phase 2, transport proof

Test these cases against the Worker runtime:

- two workspaces at the same time;
- two users in one workspace;
- concurrent tool calls in one runtime;
- a hibernation and wake cycle;
- a stale `rpc:executor` registration;
- Decide progress and timeout behavior;
- OAuth token refresh and disconnect cleanup.

### Phase 3, connector cleanup

- make connector id to Executor slug mapping canonical;
- reconcile capability sync with workspace-owned connections;
- remove unused per-connector MCP runtime state;
- make unknown hosted tools fail closed;
- add structured transport fields to runtime telemetry.

### Phase 4, Executor v2 evaluation

Evaluate v2 only after phase 2 passes. The evaluation must prove:

- programmatic client authentication;
- one Garden workspace per Executor organization or scoped connection;
- connection ownership and token refresh;
- direct calls and multi-step execution;
- approval and resume behavior;
- failure and audit propagation.

Executor v2 is a possible integration-plane implementation. It is not a
substitute for Garden runtime scoping.

## Acceptance criteria

- Two identities never address the same scoped Executor MCP name.
- An old `rpc:executor` registration is removed and replaced on wake.
- Garden tool keys remain based on local server id `executor`.
- Executor session metadata matches the runtime that created the session.
- A failing Decide call does not silently retry or switch transport paths.
- The test suite covers the scope function and registration behavior.
- A real Worker test proves cross-identity isolation before deployment.

## Source references

- `packages/agent-runtime/src/runtime-mcp-controller.ts`
- `packages/agent-runtime/src/agent-do.ts`
- `packages/agent-runtime/src/run-sub-agent-base.ts`
- `apps/web/src/lib/server/executor-engine/mcp.ts`
- `apps/web/src/lib/server/executor-engine/direct-decide-mcp.ts`
- `docs/core/connectors.md`
- `docs/known-gaps/connectors.md`
- installed `agents@0.17.3` RPC transport and PartyServer source
- Executor MCP documentation at <https://executor.sh/docs/mcp>
