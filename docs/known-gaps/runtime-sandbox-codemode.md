# Runtime sandbox + codemode gaps

**Status:** known gap  
**Last reviewed:** 2026-05-19

This note captures the current Garden runtime boundary after comparing our code with the Project Think assistant starter in `cloudflare/agents/examples/assistant`, installed `@cloudflare/think@0.6.0`, installed `@cloudflare/shell`, installed `@cloudflare/codemode`, and the public `cloudflare/agents` issue tracker.

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

`@cloudflare/think/tools/sandbox` exists but is currently a placeholder. In `@cloudflare/think@0.6.0`, `createSandboxTools()` logs a warning and returns `{}`:

```ts
console.warn("[@cloudflare/think] createSandboxTools is not yet implemented. No tools will be registered.")
return {}
```

That means Garden’s custom `createSandboxTools()` is not duplicating a working Think SDK implementation; it is filling a real gap with direct `@cloudflare/sandbox` APIs.

## Comparison matrix

| Capability | Starter codemode / `state.*` | Garden custom `sandbox*` tools |
| --- | --- | --- |
| Runtime | Dynamic Worker via `WorkerLoader` | Cloudflare Sandbox container |
| Code language | JavaScript only; prompt says no TypeScript syntax | Shell commands, Python/JS/TS interpreter, long-running processes |
| Filesystem | Think/Shell `Workspace` virtual FS | Container `/workspace` |
| Persistence | DO SQLite/R2/proxy-backed workspace | Sandbox/container instance state; sleeps after idle |
| Tool calls | Workers RPC `ToolDispatcher` back to host | Direct Sandbox SDK methods (`exec`, `runCode`, `readFile`, etc.) |
| Network | blocked by default (`globalOutbound: null`) | governed by container/Sandbox SDK behavior |
| Ports/processes | no long-running process management | `startProcess`, `listProcesses`, `killProcess`, `exposePort` |
| Workspace sync | native, because `state.*` is the workspace | none yet; needs explicit bridge |
| Approval/pause fit | inner calls bypass AI SDK `needsApproval`; dispatch-layer gate needed | direct outer tools can be gated normally once local tools are classified |

## Known gaps

1. **No Workspace ↔ container sync.** Files written through Think workspace tools or codemode `state.*` are not visible to `sandboxExec`; files produced in `/workspace` are not visible in Think workspace unless a tool explicitly copies them back.
2. **Prompt terminology is ambiguous.** Runtime prompts currently describe `/workspace` as Garden’s persistent workspace, but Think’s built-in workspace tools operate on the virtual Workspace, not the container path.
3. **Two sandbox concepts share language.** “sandbox” can mean codemode Dynamic Worker, Think’s placeholder `createSandboxTools`, or Cloudflare Sandbox container tools.
4. **Think SDK sandbox tools are no-op.** We cannot rely on `@cloudflare/think/tools/sandbox` until upstream implements it.
5. **Garden custom sandbox option/id logic is duplicated.** Chat, issue-run, and automation-run classes repeat sandbox id compaction/hash/options.
6. **Container image/version may drift from SDK package.** `@cloudflare/sandbox` is pinned via pnpm, while `apps/web/Dockerfile` pins a separate image tag. Keep these intentionally aligned.
7. **Codemode currently mostly exposes `state.*`, not Garden domain tools.** `createExecuteTool` in chat passes `tools: {}` today, unlike the starter which passes `createWorkspaceTools(this.workspace)`. Think still auto-merges workspace tools outside `execute`, but code inside `execute` only gets `state.*` plus any providers we add.
8. **Permission gates for codemode inner calls remain deferred.** Existing plans correctly move gating to a dispatch wrapper; direct AI SDK `needsApproval` cannot see calls made inside codemode.

## Related upstream issues found

No issue specifically tracked `@cloudflare/think/tools/sandbox` being a no-op in search results. Related open or historical issues that shape our constraints:

- cloudflare/agents#1112 — codemode custom modules / avoiding reimplementing `DynamicWorkerExecutor`.
- cloudflare/agents#1121 — codemode support for MCP-discovered tools and per-group type emission.
- cloudflare/agents#1203 — MCP result wrappers in codemode sandbox; relevant to inner-tool return semantics.
- cloudflare/agents#959 — codemode docs vs TypeScript syntax support; reinforces that generated code should be JavaScript.
- cloudflare/agents#806 — codemode hyphenated MCP tool names; relevant if we expose connector tools inside codemode.
- cloudflare/agents#1148 — approval flows with codemode; same problem space as Garden’s dispatch-layer gate plan.

## Near-term stance

Keep both paths, but name them precisely:

- Use **codemode execute** for bounded JavaScript orchestration and multi-file virtual Workspace operations.
- Use **container sandbox** for native binaries, shell commands, package installs, generated previews, and long-running processes.
- Do not pretend they share storage until an explicit bridge ships.
