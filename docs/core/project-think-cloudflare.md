# Project Think + Cloudflare integration

**Status:** current implementation notes
**Last reviewed:** 2026-06-07

Garden uses Cloudflare Agents + Think as the live agent loop, Durable Objects as runtime identity, Workflows as long-running execution durability, and Postgres as the queryable control plane.

## Runtime shape

| Runtime piece | Current owner | Code evidence |
| --- | --- | --- |
| Agent identity and RPC parent | `AgentDO extends Agent` | `packages/agent-runtime/src/agent-do.ts` |
| Chat conversations | `ChatSubAgent extends Think`, keyed by chat thread id | `packages/agent-runtime/src/agent-do.ts:905` |
| Issue work | `IssueRunSubAgent extends Think`, keyed by issue id | `packages/agent-runtime/src/issue-run-sub-agent.ts` |
| Automation work | `AutomationRunSubAgent extends Think`, keyed by automation run id | `packages/agent-runtime/src/automation-run-sub-agent.ts` |
| Durable run coordination | `RunWorkflow` Workflow + Think durable submissions, instance id = run id | `packages/agent-runtime/src/run-workflow.ts`, `IssueRunSubAgent.submitWorkflowTurn`, `AutomationRunSubAgent.submitWorkflowTurn` |
| Schedule trigger state | `AutomationTriggerDO` | `packages/agent-runtime/src/automation-trigger-do.ts` |
| Runtime bindings | `AgentDO`, `Sandbox`, `AUTOMATION_TRIGGER`, `MCP_SESSION`, `RUN_WORKFLOW`, `LOADER`, `FILES` | `apps/web/wrangler.jsonc` |

## Chat model

Garden chat is **one `ChatSubAgent` facet per product chat**, under one parent `AgentDO` per agent runtime identity.

- Postgres `chat_thread` stores chat metadata and routing fields.
- Browser code connects to `AgentDO` and a `ChatSubAgent` child via `useAgent`.
- Server code creates/routes the same child with `this.subAgent(ChatSubAgent, threadId)`.
- Think session storage remains local to the child facet and is not the global chat registry.

See [`chat-runtime-model.md`](./chat-runtime-model.md).

## Long-running work

Issues and automations are separate product ledgers that share one durable execution boundary — `RunWorkflow` on Cloudflare Workflows, driving Think durable submissions turn by turn. Full engine design: [`docs/core/workflows-engine.md`](./workflows-engine.md).

## `createExecuteTool`

Chat and automation runtimes use Think codemode for bounded JavaScript orchestration through `createExecuteTool` and the `LOADER` worker-loader binding. The container sandbox is a separate Cloudflare Sandbox path for shell/native execution.

Important distinction:

- codemode `execute` operates through Think/codemode and `state.*` / configured providers;
- Garden `sandbox*` tools operate inside a Cloudflare Sandbox container `/workspace`;
- the two filesystems do not share files until an explicit bridge exists.

See [`docs/known-gaps/runtime-sandbox-codemode.md`](../known-gaps/runtime-sandbox-codemode.md).

## Design rules

- Do not monkey-patch SDK lifecycle methods.
- Do not switch live Think chats by mutating `this.session`.
- Do not put a queue between `AgentDO` and `RunWorkflow` unless a current Cloudflare platform gap is documented.
- Use Think durable `submitMessages()` for server-driven run turns; do not rebuild the old DO-local waiter/recovery layer.
- Prefer Agents SDK built-ins from the current version: `getAgentByName(..., { routingRetry })` for server-side stub resolution and `id` on MCP server registration for stable connector ids.
- Keep app-wide realtime separate from agent/chat websocket streaming.
