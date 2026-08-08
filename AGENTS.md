Session rules:

- When talking to the user, sacrifice grammar for concision. Drop articles, punctuation, capitalization — whatever shaves words without losing meaning.
- If the next action is non-destructive and naturally follows from the user's request, do it proactively. Do not wait for approval or turn-by-turn feedback.
- Keep moving through safe next steps until the task is done or you hit a real blocker.
- Greenfield codebase, no users to preserve — rip things out and reshape data structures freely; ship the cleanest version of the change. Hold every line to production quality: rigorous code, thoughtful UX, real product thinking. Scope stays narrow; craft stays high.
- No overengineering. Pick the simplest approach that fits the codebase and the task.
- Product feel matters: the app should feel fast, snappy, and local-first. Prefer proper caching, preloading, optimistic updates, and reuse of warm UI/runtime state so users rarely see loading states.
- Use `better-result` as a typed workflow toolkit, not just an error wrapper. Model rich product/domain outcomes in `Result.ok(...)`; reserve `Result.err(...)` for recoverable operation failures callers must handle. Prefer `Result.gen`, `Result.await`, `andThen`, `mapError`, `tryRecover`, `tap`/`tapBoth`, and boundary `.match(...)`/`matchError(...)` over scattered `isOk()`/`isErr()` branching, nullable sentinels, booleans, or thrown domain exceptions.
- Never use `try/catch`.
- React `useEffect` is banned. Use loaders, server functions, event handlers, subscriptions, or derived state instead.
- For API and server boundary validation, prefer shared Zod schemas and use `drizzle-zod` where DB-backed shapes should stay in sync with Drizzle schema.
- For schema migrations, edit the Drizzle schema first and run `pnpm --filter @garden/db db:generate`. Do not hand-write raw schema SQL. Raw SQL is only acceptable for data migrations or hand-authored data repair/backfill steps that Drizzle cannot generate.
- Only invoke skills once you understand the problem surface — never preemptively. First read the relevant files, confirm what the task actually touches, then decide if a skill applies. If you invoke a skill, state which one and why it fits the verified surface.
- When listing available skills to the user, do it as a check — name only the ones whose trigger conditions match what you've already verified about the task. Do not dump the full skill list or claim a skill is relevant before you've looked at the code.
- The `better-result` skill applies when you've confirmed the change touches TypeScript Result workflows, error handling, domain outcomes, callback statuses, retries, serialization, or tagged errors. Read its bundled `opensrc/better-result` source before non-trivial changes. Don't invoke it for unrelated edits (docs, config, non-TS files).
- Don't start, stop, kill, or restart local servers casually. If you genuinely need a running server (e.g. to verify a fix end-to-end, smoke-test a UI change, or reproduce a bug), reuse an already-running port first; only start your own when nothing's listening. Always tear down anything you started.
- Use the dedicated root `pnpm dev` orchestration for local development. Executor connector APIs and MCP Durable Objects are part of the Garden web Worker; there is no separate connector or MCP-proxy service to boot.
- Do not use `git stash` by default. Multiple agents may be working concurrently on this branch and a stash hides their in-flight work from them. If the user explicitly asks to stash, do it. Otherwise, stage clean commits by path with `git add <files>` and let unrelated dirty files stay in the working tree.
- Commit after every major change. Stage only the files relevant to that change with `git add <files>` and write a focused commit message — don't batch unrelated work into one commit, and don't leave large completed work uncommitted.

TanStack docs:

- This repo has TanStack skill docs installed inside `node_modules/@tanstack/**/skills/**/SKILL.md`.
- Read those before changing TanStack Start, Router, auth guards, loaders, server functions, or related routing patterns.
- Useful commands:
  - `sed -n '1,260p' node_modules/@tanstack/router-core/skills/router-core/SKILL.md`
  - `sed -n '1,260p' node_modules/@tanstack/start-client-core/skills/start-core/SKILL.md`
  - `sed -n '1,260p' node_modules/@tanstack/router-core/skills/router-core/auth-and-guards/SKILL.md`
  - `find node_modules/@tanstack -path '*/skills/*/SKILL.md' | sort | sed -n '1,260p'`

Terminology:

- "Context menu" or "explore menu" refers to the inner rail (the context rail tied to the active tab), not the sidebar rail.

Cloudflare Agents SDK / MCP storage:

- Don't monkey-patch SDK manager methods (`MCPClientManager.restoreConnectionsFromStorage`, etc.). The SDK methods reference `this.sql`/`this.storage` — destructuring or reassigning them silently breaks `this` binding and the failure surfaces deep inside an alarm dispatch with `Cannot read properties of undefined (reading 'sql')`.
- Operate on data we own via `ctx.storage.sql` directly when you need to influence what the SDK restores from `cf_agents_mcp_servers`. Tables created by the SDK base `Agent` constructor (`_ensureSchema`) are available right after `super(ctx, env)` returns, so a synchronous prune in the subclass constructor runs before the SDK's wrapped `onStart` calls `restoreConnectionsFromStorage`.
- The SDK auto-restores every row in `cf_agents_mcp_servers` on wake. For garden connectors the only valid `server_url` is `rpc:<connectorId>` — never persist HTTP MCP URLs there.
- One-time data migrations live as a one-shot script (or a manual cleanup), then get deleted. Don't leave migration logic running on every cold start "just in case" — that's how silent bugs accumulate (we just removed `enforceRpcOnlyMcpConnectorRestore` for exactly this reason).
- Sub-agent (facet) lifecycle: `_cf_initAsFacet` calls `__unsafe_ensureInitialized` which calls the SDK-wrapped `onStart`, which (1) runs `restoreConnectionsFromStorage` then (2) runs the user's `onStart`. The user's `onStart` is too late to influence restore — do that work in the constructor.

Cloudflare run orchestration:

- Treat Cloudflare Workflows as the durable execution, retry, wait, resume, and cancel boundary for long-running issue/automation runs. Do not add a second recovery layer (`Think.chatRecovery`, manual `runFiber`/`stash`, orphaned transcript scrubbers, timeout loops) unless the installed SDK/docs prove Workflows cannot own that concern.
- Use SDK primitives before writing glue: `Think.saveMessages` for programmatic turns, `waitUntilStable` before server-driven messages that may overlap, `Workflow.waitForEvent`/`sendEvent` for resume/cancel, Agent callable RPC for DO boundaries, and workflow instance IDs for idempotency.
- `override` on `Think` subclasses is normal hook usage (`getModel`, `configureSession`, `beforeTurn`, `beforeToolCall`, `onStepFinish`, `onChatResponse`). Monkey-patching, method reassignment, loose method references, custom transcript repair, or duplicate queue/resume layers are debt until proven necessary.
- Automations are a separate product surface and run ledger. They must not be modeled as issues, create kanban cards, use `issue_run` as their execution path, or keep issue compatibility paths. If an automation truly needs to touch issues, that is explicit domain behavior in its prompt/tools, not the orchestration model.
- No loose automation configs. Automation templates, execution config, output config, run input, capabilities, required skills, required connectors, and result payloads must be defined through one typed registry/shared Zod schema. Do not scatter ad hoc `jsonb` shape checks, optional config blobs, stringly `kind` branches, or UI-only schema guesses. If a new automation type exists, add or update the canonical template/contract schema first, then have UI, API, DB writes, and runtime read that same shape.
- Do not invent arbitrary timeout values. Use SDK/platform defaults first; only add a timeout when a measured failure or documented limit requires it, and explain why that exact bound is correct.
- Do not mix product semantics with infrastructure recovery. Recovery hooks should preserve or resume SDK/runtime state; they must not rewrite user-facing tool payloads, reinterpret business actions, or transform HITL/product flows unless a product requirement explicitly asks for that behavior.
- Bad framing: "MVP", "fallback", "compat", or "safety net" is not a reason to keep glue. Say exactly which SDK/platform gap requires it, link the source, and delete the path when the gap is gone. Greenfield default is remove/reshape, not preserve.

General code hygiene:

- Add JSDoc above every non-trivial function, class method, hook, server function, route handler, store action, and implementation block whose purpose is not obvious from its name and types. The JSDoc must explain why this code exists, the observed behavior before the change, the intended behavior after the change, and any docs or source references consulted (for example SDK docs, installed package source, framework docs, or local reference code). Keep it concise but concrete; future agents should understand the decision without reconstructing the whole debugging session.
- Prefer `rg` over `grep` for code search. When searching `.`, use `rg` first.
- Never destructure methods off an object you'll then call. Either call as `obj.method(...)` or bind explicitly (`obj.method.bind(obj)`). Loose method references quietly drop `this`.

Local dev URLs:

- Default local web URL is `http://localhost:3000`.
- Use root `pnpm dev` for normal development. It boots the Garden web Worker, including its in-process Executor connector and MCP surfaces.
- Local development variables live in root `.env`; auth/OAuth callbacks target `localhost:3000` through that file and `apps/web/wrangler.jsonc`.
