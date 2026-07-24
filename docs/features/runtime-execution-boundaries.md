# Runtime Execution Boundaries

Garden uses different Cloudflare durability primitives for different job shapes. Do not collapse these into one runtime abstraction.

## Product runs: Workflows

Issue runs and automation runs are product-ledger executions with explicit run ids, database status, audit events, user-visible cancellation, and durable waits for Think submissions. Keep them on Cloudflare Workflows via `AgentWorkflow` and `this.runWorkflow(...)`. Full engine design, lifecycle, and code map: [`docs/core/workflows-engine.md`](../core/workflows-engine.md).

## Agent background work: managed fibers

Managed fibers are for agent-local background work that should survive DO eviction but is not itself a product run. They are useful when the work belongs to one Agent/DO and needs SDK-native inspection or cancellation via `startFiber`, `runFiber`, `inspectFiber`, `listFibers`, `cancelFiber`, `FiberContext.signal`, and `stash()`.

Good future uses:

- connector capability refreshes
- cache/materialization jobs
- background artifact build tasks that are not tied to an issue/automation run
- non-critical sandbox cleanup or warmup
- agent maintenance work

Do not replace issue runs or automation runs with fibers unless Workflows cannot express a proven requirement. Product runs need Workflow-level orchestration plus Garden's run ledger.

## Artifacts and previews

Sandbox quick tunnels are preview transport, not durable artifact storage. Use them to show a generated web artifact while the sandbox is alive. Persist accepted artifacts separately in Garden storage.
