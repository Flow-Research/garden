# Runtime sandbox + codemode gaps

**Status:** deferred architectural note; no active Flow Research issue
**Last reviewed:** 2026-07-23

This note captures the current Garden runtime boundary after comparing our code with the Project Think assistant starter in `cloudflare/agents/examples/assistant`, installed `@cloudflare/think@0.8.6`, installed `@cloudflare/shell@0.3.9`, installed `@cloudflare/codemode@0.3.8`, and the public Cloudflare Agents changelog.

## Current Garden behavior

Garden currently exposes two different execution/workspace paths to agents:

1. **Codemode `execute` tool** — wired in `packages/agent-runtime/src/chat-sub-agent-tools.ts` through `createExecuteTool({ state: createWorkspaceStateBackend(workspace), loader })`. This runs LLM-authored JavaScript in a Dynamic Worker and exposes `state.*` backed by the Think/Shell `Workspace`.
2. **Custom Cloudflare Sandbox tools** — wired in `packages/agent-runtime/src/sandbox-tools.ts` and backed by `@cloudflare/sandbox` containers via `getSandbox(...).exec/runCode/readFile/writeFile/...`. This is a real Linux/container `/workspace` with processes, package installs, port exposure, Python/Node execution, and container filesystem state.

These paths do **not** share files today. Think/Shell `Workspace` is durable DO SQLite/R2-backed virtual filesystem state. Cloudflare Sandbox `/workspace` is container filesystem state. Sync/bridging is intentionally deferred.

## Project Think assistant starter behavior

The Think assistant starter does not use `@cloudflare/sandbox` containers for its codemode path. It uses:

```ts
execute: createExecuteTool({
  tools: createWorkspaceTools(this.workspace),
  state: createWorkspaceStateBackend(this.workspace),
  loader: this.env.LOADER,
})
```

Important details from `cloudflare/agents/examples/assistant`:

- Parent `AssistantDirectory` owns one shared `Workspace`.
- Child `MyAssistant extends Think` overrides `workspace` with a `SharedWorkspace` proxy into the parent.
- Think built-in workspace tools, `createWorkspaceTools(this.workspace)`, and codemode `state.*` all hit the same shared workspace.
- Codemode execution is Dynamic Worker / `@cloudflare/codemode`, not a Linux container.
- `@cloudflare/sandbox` is absent from the starter.

So, when we say “starter kit codemode,” we mean a JS Dynamic Worker sandbox whose file API is `state.*` over the Think/Shell workspace. It is not equivalent to Garden’s custom `sandbox*` tools.

## SDK sandbox export status

`@cloudflare/think/tools/sandbox` still exists as a placeholder. In `@cloudflare/think@0.8.6`, `createSandboxTools()` logs a warning and returns `{}`:

```ts
console.warn("[@cloudflare/think] createSandboxTools is not yet implemented. No tools will be registered.")
return {}
```

That means Garden’s custom `createSandboxTools()` is not duplicating a working Think SDK implementation; it is filling a real gap with direct `@cloudflare/sandbox` APIs.

## Product tradeoffs

### Starter codemode / `state.*`

Codemode is best for product flows where the agent needs to coordinate many bounded tool/file operations in one model step. It lets the model write JavaScript that runs in an isolated sandbox and calls host-provided tools through RPC. When backed by `createWorkspaceStateBackend(this.workspace)`, the code can use `state.*` to read/write the durable Think/Shell workspace, plan/apply multi-file edits, search and replace across files, transform JSON, create archives, hash files, and return a structured result.

This is a good product fit for “inspect these docs, update several workspace files, summarize what changed” and similar tool-orchestration tasks. It keeps the outer LLM loop smaller because twenty inner file/tool calls can happen under one `execute` tool call.

Codemode is not a product substitute for a real machine. It does not run native binaries, install packages into a persistent environment, host preview servers, keep long-running processes, or naturally operate on a real checkout unless that checkout is represented through Workspace/provider tools. It is also awkward for approval-required capabilities: calls inside codemode are inner RPC calls, not outer AI SDK tool calls, so product-grade approval needs dispatch-layer gating or a policy that keeps ask-required tools out of the codemode surface.

### Garden container sandbox tools

The custom `sandbox*` tools are best when the product needs a real execution environment: shell commands, package installs, generated app previews, tests/builds, document conversion with native tools, Python/data tooling, background processes, and exposed ports. This product surface feels closer to “the agent has a computer.”

The cost is more runtime surface area: separate container filesystem state, cold starts, lifecycle cleanup, package/image drift, stronger permission risk, output truncation, and the need to decide which container artifacts should be imported back into Garden’s durable Workspace.

Until sync ships, treat container files as execution/scratch artifacts and Think/Shell Workspace files as durable Garden artifacts.

## Dynamic Worker requirement

Codemode does **not** strictly require Dynamic Workers. `createExecuteTool()` accepts either:

- `loader`, which constructs a `DynamicWorkerExecutor` with a `WorkerLoader` binding.
- `executor`, any custom implementation of the `@cloudflare/codemode` `Executor` interface.

For Cloudflare Workers, `WorkerLoader` + `DynamicWorkerExecutor` is the standard Project Think starter path. Garden’s current `execute` tool uses `loader`, so the current deployed path does require the `LOADER` worker loader binding. But the codemode abstraction is executor-based, so another sandbox runtime can be substituted if it implements `execute(code, providers)`.

## Comparison matrix

| Capability | Starter codemode / `state.*` | Garden custom `sandbox*` tools |
| --- | --- | --- |
| Product feel | Agent scripts its tools and durable workspace | Agent has a real execution computer |
| Runtime | Dynamic Worker via `WorkerLoader` by default; custom `Executor` possible | Cloudflare Sandbox container |
| Code language | JavaScript only; prompt says no TypeScript syntax | Shell commands, Python/JS/TS interpreter, long-running processes |
| Filesystem | Think/Shell `Workspace` virtual FS | Container `/workspace` |
| Persistence | DO SQLite/R2/proxy-backed workspace | Sandbox/container instance state; sleeps after idle |
| Tool calls | Workers RPC `ToolDispatcher` back to host | Direct Sandbox SDK methods (`exec`, `runCode`, `readFile`, etc.) |
| Network | blocked by default (`globalOutbound: null`) | governed by container/Sandbox SDK behavior |
| Ports/processes | no long-running process management | `startProcess`, `listProcesses`, `killProcess`, `exposePort` |
| Workspace sync | native, because `state.*` is the workspace | none yet; needs explicit bridge |
| Approval/pause fit | inner calls bypass AI SDK `needsApproval`; dispatch-layer gate needed | direct outer tools can be gated normally once local tools are classified |

## Deferred constraints

These are deliberate boundaries, not current beta work:

1. **No Workspace ↔ container sync.** Files written through Think workspace tools or codemode `state.*` are not visible to `sandboxExec`; files produced in `/workspace` are not visible in Think workspace unless a tool explicitly copies them back.
2. **Different sandbox concepts require precise naming.** Codemode Dynamic Workers, Think's placeholder sandbox export, and Cloudflare Sandbox containers are distinct runtimes.
3. **Think SDK sandbox tools remain no-op.** Garden's custom container tools fill that SDK gap.
4. **Codemode exposes `state.*`, not broad Garden domain tools.** Adding inner tools also requires an explicit dispatch-layer approval design.
5. **Container and package versions are intentionally aligned.** The workspace catalog and production Alchemy/ Wrangler image references use `@cloudflare/sandbox@0.12.4` with `docker.io/cloudflare/sandbox:0.12.4-python`. Production uses the official prebuilt image so Workers Builds does not require Docker.

Do not create active work for synchronization, shared storage, or expanded codemode tools until a concrete workflow requires them.

## Upgrade audit notes (2026-06-07)

- `@cloudflare/think@0.8.6` adds more built-in workspace behavior, including the default workspace `bash` tool via `workspaceBash`. Garden keeps its custom container sandbox tools because the SDK sandbox tool remains no-op.
- `@cloudflare/think/tools/execute` now documents `state.*` as the preferred filesystem surface inside codemode. Garden already uses `createWorkspaceStateBackend(this.workspace)`.
- Direct Garden runtime dependencies are aligned with Think's nested versions: `@cloudflare/shell@0.3.9` and `@cloudflare/codemode@0.3.8`, avoiding duplicate old Shell/Codemode copies in `@garden/agent-runtime`.

## Related upstream issues found

No issue specifically tracked `@cloudflare/think/tools/sandbox` being a no-op in search results. Related open or historical issues that shape our constraints:

- cloudflare/agents#1112 — codemode custom modules / avoiding reimplementing `DynamicWorkerExecutor`.
- cloudflare/agents#1121 — codemode support for MCP-discovered tools and per-group type emission.
- cloudflare/agents#1203 — MCP result wrappers in codemode sandbox; relevant to inner-tool return semantics.
- cloudflare/agents#959 — codemode docs vs TypeScript syntax support; reinforces that generated code should be JavaScript.
- cloudflare/agents#806 — codemode hyphenated MCP tool names; relevant if we expose connector tools inside codemode.
- cloudflare/agents#1148 — approval flows with codemode; same problem space as Garden’s dispatch-layer gate plan.

## Production deployment correction (2026-07-23)

- Removed the fabricated Workers-CI `Container` cast. Alchemy now receives a complete, supported prebuilt-image `Container` in every environment.
- Production creates or adopts `garden-web-sandbox-staging`; it no longer assumes that a staging container already exists.
- The official prebuilt Python image avoids Docker in Workers Builds while retaining the Sandbox SDK's native process, filesystem, interpreter, and tunnel runtime.
- All Sandbox clients and runtime configuration use RPC transport.

## Near-term stance

Keep both paths, but name them precisely:

- Use **codemode execute** for bounded JavaScript orchestration and multi-file virtual Workspace operations.
- Use **container sandbox** for native binaries, shell commands, package installs, generated previews, and long-running processes.
- Do not pretend they share storage until an explicit bridge ships.
