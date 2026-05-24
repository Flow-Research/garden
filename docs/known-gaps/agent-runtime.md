# Agent Runtime

Current code has the core runtime topology in place. This file tracks remaining gaps without relitigating the resolved chat/session model.

## Current implementation

| Item | Evidence |
| --- | --- |
| Generic parent runtime: one `AgentDO` per agent runtime name | `packages/agent-runtime/src/agent-do.ts:285`, `packages/db/src/schema/agents.ts` |
| Data-driven agent rows with persona/config/permissions | `packages/db/src/schema/agents.ts` (`runtimeConfig`, `permissions`, `hostName`, `runTimeoutSec`) |
| Chat facets keyed by thread id | `packages/agent-runtime/src/agent-do.ts:299-477`, `ChatSubAgent` at `agent-do.ts:905` |
| Issue-run facets keyed by issue id | `packages/agent-runtime/src/agent-do.ts:549-608`, `packages/agent-runtime/src/issue-run-sub-agent.ts` |
| Automation-run facets keyed by run id | `packages/agent-runtime/src/agent-do.ts:556-644`, `packages/agent-runtime/src/automation-run-sub-agent.ts` |
| Long-running run durability through Workflows + Think durable submissions | `packages/agent-runtime/src/run-workflow.ts`, `AgentDO.startIssueRunWorkflow`, `IssueRunSubAgent.submitWorkflowTurn`, `AutomationRunSubAgent.submitWorkflowTurn` |
| Context-window overflow recovery | `ChatSubAgent`, `IssueRunSubAgent`, and `AutomationRunSubAgent` set `contextOverflow = createGardenContextOverflow()` and `classifyChatError = classifyGardenContextOverflow` |
| Chat browser path uses Agents sub-agent routing | `apps/web/src/features/chat/chat-runtime-provider.tsx:102-112` |
| Prompt contexts for chat | `ChatSubAgent.configureSession()` wires `foundation`, `agent`, and `workspace`; assigned skills are loaded through `getSkills()` / `createGardenSkillSources()` |
| Issue-run prompt context | `IssueRunSubAgent.configureSession()` wires `foundation` + bundled `issue-interaction`; assigned skills are loaded through `getSkills()` |
| Automation-run prompt context | `AutomationRunSubAgent.configureSession()` wires `foundation` + `automation-run`; assigned skills are loaded through `getSkills()` |

## Resolved runtime decisions

### Chat keying

Garden should continue using `AgentDO` + `ChatSubAgent(threadId)`. Do not replace it with one mutable Think instance plus `this.session.forSession(id)`.

Evidence and rationale live in [`docs/core/chat-runtime-model.md`](../core/chat-runtime-model.md). Upstream direction is `subAgents <> sessions`; the current code matches that model.

### Durable issue/automation turns

Garden now uses Think durable `submitMessages()` for issue and automation turns, with Workflow waiting on `onSubmissionStatus` events. Do not reintroduce DO-local waiter maps, manual recovery queues, or transcript repair loops. `@cloudflare/think@0.8.6` also keeps `Think.chat()` RPC turns inside chat recovery fibers, so helper/agent-tool style child runs recover better after Durable Object eviction.

## Active verification work

| Issue | Outcome | Priority |
| --- | --- | --- |
| FLO-31 | Prove issue and automation facets survive the full run lifecycle in staging through `RunWorkflow`, including resume after eviction and duplicate-start prevention. | High |
| FLO-37 | Capture prompt/config snapshots and add secret-safe tracing and regression evaluations across chat, issue, and automation runtimes. | Medium |

## Deferred runtime decisions

Parent-backed shared files, memory/search, a global artifact bucket, workspace-wide runtime warming, app-wide realtime invalidation, and a Workspace/container bridge are not current gaps. Each requires a concrete product workflow or measured failure before implementation. The stream-stall watchdog also stays disabled until observed stall data supports a correct bound.

## Right implementation patterns

- Keep `AgentDO` + `ChatSubAgent` routing for chat isolation.
- Hoist only the resource that needs sharing: workspace files, MCP registry, memory/search, artifact bucket, etc.
- Use parent RPC or remote providers from child facets instead of mutating child SQLite directly.
- Keep prompt text cache-stable; expose dynamic capability state through bounded tools/inventory.
- Keep Workflows as the durable retry/wait/cancel boundary for long-running issue and automation work.

## Current prompt layers

### Chat

1. `foundation` — `packages/agent-runtime/src/instructions/base.ts`
2. `agent` — Postgres `agent.name`, `role_title`, `instructions`
3. `workspace` — Postgres `organization.name`, `organization.context`
4. `skills` — assigned skills via `agent_skill` + `skill`, loaded from R2 through Think-native `SkillSource`s created by `createGardenSkillSources`

### Issue runs

1. `foundation`
2. `issue-interaction` — bundled skill at `packages/agent-runtime/src/skills/issue-interaction/SKILL.md`

### Automation runs

1. `foundation`
2. `automation-run` — runtime-specific instructions in `AutomationRunSubAgent.configureSession()`
3. `skills`
