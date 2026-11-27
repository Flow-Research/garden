---
title: Codemode and the container sandbox solve different jobs
description: Why Garden agents have two execution paths, Think codemode and a Cloudflare Sandbox container, and when each one fits.
status: current
owner: "@Umoren"
last_reviewed: 2026-11-03
---

Garden agents can run code in two places. Codemode runs JavaScript in a Dynamic Worker against the agent's Think workspace. The container sandbox runs shell commands and programs in a Cloudflare Sandbox Linux container. The two paths look alike from the model's side, but they have different file systems, limits, and risks. Mixing them up leads to bugs where a file "disappears" between tools.

The versions in the `pnpm-workspace.yaml` catalog are `@cloudflare/think` 0.24.0, `@cloudflare/computer` 0.10.0, `@cloudflare/codemode` 0.5.6, and `@cloudflare/sandbox` 0.12.4.

## Codemode scripts the workspace

`ChatSubAgent` gets its `execute` tool from `createExecuteTool` in `packages/agent-runtime/src/chat-sub-agent-tools.ts`. The call passes `tools: createAITools({ workspace })` and the `LOADER` Worker Loader binding. `AutomationRunSubAgent` and `IssueRunSubAgent` also pass `LOADER` to their codemode tools.

Inside `execute`, the model writes JavaScript. That code reaches workspace tools through `tools.*` (from `@cloudflare/computer/tools/ai-sdk`). Each facet stores execution files in its own Durable Object through `@cloudflare/computer`. Use the document tools to open or change Garden documents. These tools use the facet’s existing Shell SQLite index and its R2 spill keys. Execution code has no mount into the shared `FILES` bucket. One `execute` call can read many files, edit several, transform JSON, and return a structured result. That keeps the outer model loop short, because twenty file operations count as one tool call.

The document tools read existing document versions through the facet's Shell index, including versions stored in R2. Older chat transcripts can also contain media paths under `/attachments/evicted/`. The chat and codemode `read` tools resolve these paths in the same facet's Shell workspace. This read does not copy files into Computer storage. Other files that an earlier chat or run wrote with Shell workspace tools remain in the old storage. The Computer tools cannot list or open those files. Before a production switch, identify threads and runs that need those files. The release owner must approve how to preserve them and verify a representative existing thread.

Codemode fits tasks such as "read these docs, update three workspace files, and summarize what changed".

Codemode is not a computer. It cannot run native binaries, install packages, host a preview server, or keep a process alive. Tool calls made inside codemode are inner RPC calls, not outer AI SDK tool calls. That means a tool that needs user approval cannot rely on the normal AI SDK approval step inside codemode. Approval has to be enforced where the call is dispatched, or the tool has to stay out of the codemode surface. For how Garden gates Executor tools inside codemode, see [connectors](./connectors.md).

## The container sandbox is a real machine

`createSandboxTools` in `packages/agent-runtime/src/sandbox-tools.ts` gives agents these tools, backed by `@cloudflare/sandbox`:

- `sandboxExec`, `sandboxRunCode`
- `sandboxReadFile`, `sandboxWriteFile`, `sandboxListFiles`
- `sandboxStartProcess`, `sandboxListProcesses`, `sandboxKillProcess`
- `sandboxExposePort`

They run in a container `/workspace` with real processes, package installs, Python and Node, and exposed ports. Use this path for shell commands, tests and builds, document conversion with native tools, data work in Python, and generated app previews.

That power has costs. The container has its own file system, cold starts, and cleanup work. Its image can drift from the package version. It carries more permission risk, and long output gets cut off. Both `apps/web/wrangler.jsonc` and `alchemy.run.ts` pin the image to `docker.io/cloudflare/sandbox:0.12.4-python`, which matches the `@cloudflare/sandbox` 0.12.4 package.

## The two file systems do not share files

A file written through Think workspace tools or codemode `tools.*` is not visible to `sandboxExec`. A file created in the container `/workspace` is not visible in the Think workspace unless a tool copies it back. No bridge exists.

Until one does, treat container files as scratch output and Think workspace files as durable Garden artifacts.

## Compare the two paths

The table below sets the two paths side by side.

| | Codemode `execute` | Container `sandbox*` tools |
| --- | --- | --- |
| Runtime | Dynamic Worker through `LOADER` | Cloudflare Sandbox container |
| Language | JavaScript | Shell, Python, JavaScript, and TypeScript |
| File system | Facet-owned Computer `Workspace` | Container `/workspace` |
| Persistence | Facet-owned DO storage for execution files | Container state, which sleeps when idle |
| Processes and ports | None | `sandboxStartProcess`, `sandboxExposePort` |
| Approval | Must be enforced at dispatch | Outer tools, gated like other tools |

## Keep both, and name them precisely

Garden keeps both paths on purpose:

- Use codemode `execute` for bounded JavaScript orchestration and multi-file workspace edits.
- Use the container sandbox for native binaries, shell commands, package installs, previews, and long-running processes.
- Say which one you mean. "Sandbox" alone is ambiguous, because codemode's Dynamic Worker is also an isolated sandbox.

Do not start work on file sync, shared storage, or more codemode tools until a concrete product workflow needs it.
