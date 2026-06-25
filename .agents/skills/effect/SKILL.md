---
name: effect
description: Use when writing, reviewing, or refactoring Effect / Effect-TS code, especially services, layers, Schema data/errors, typed error channels, runtime boundaries, dependency injection, async orchestration, or tests where Promise memory is not enough.
---

# Effect Skills

## First principle: memory is not enough

Effect changes quickly, and different projects may use different Effect versions or local forks. Do not implement from pre-trained memory. Before changing Effect code, read current project docs/source and the relevant facets below.

## Required source-first workflow

Before writing or reviewing Effect code:

1. Run `effect-solutions list`.
2. Run `effect-solutions show <topic>` for the surface you are touching.
3. Read the relevant facet files in `rules/`.
4. Inspect nearby project examples with `rg`.
5. If adding or changing `Context.Service`, `Layer.*`, dependency injection, or service composition, read the current `$EFFECT_SMOL_ROOT` source for `Context.ts`, `Layer.ts`, and the relevant `Effect.ts` combinators before designing the layer graph.
6. If an API detail matters, read `$EFFECT_SMOL_ROOT` source directly.

Useful `effect-solutions` topics:

| Topic | Use for |
| --- | --- |
| `basics` | `Effect.gen`, `Effect.fn`, `Effect.fnUntraced`, retry, timeout |
| `services-and-layers` | `Context.Service`, layers, dependency graphs |
| `data-modeling` | `Schema.Class`, branded ids, tagged variants |
| `error-handling` | `Schema.TaggedErrorClass`, defects, `catchTag`, `catchTags` |
| `testing` | Effect test style and deterministic time |
| `config` | typed config and runtime environment |

Local source/patterns to read as needed. Set `EFFECT_SMOL_ROOT` to the local Effect/effect-smol checkout; if unset, try `$HOME/effect-smol` when it exists.

- `$EFFECT_SMOL_ROOT/AGENTS.md`
- `$EFFECT_SMOL_ROOT/.patterns/effect.md`
- `$EFFECT_SMOL_ROOT/.patterns/testing.md`
- `$EFFECT_SMOL_ROOT/packages/effect/src/Effect.ts`
- `$EFFECT_SMOL_ROOT/packages/effect/src/Context.ts`
- `$EFFECT_SMOL_ROOT/packages/effect/src/Layer.ts`
- `$EFFECT_SMOL_ROOT/packages/effect/src/Schema.ts`
- `$EFFECT_SMOL_ROOT/packages/effect/src/Semaphore.ts`
- `$EFFECT_SMOL_ROOT/packages/effect/src/SynchronizedRef.ts`

## Rule facets by priority

| Priority | Facet | Read when |
| --- | --- | --- |
| CRITICAL | `source-first.md` | Any Effect task; always first |
| CRITICAL | `services-layers.md` | Adding/changing service contracts, dependency injection, layers |
| CRITICAL | `schema-data.md` | Modeling boundary data, ids, payloads, durable state |
| CRITICAL | `errors.md` | Adding/changing error handling or recovery paths |
| CRITICAL | `boundaries-promises.md` | Bridging DB, SDK, fetch, platform runtime, route/tool callbacks |
| HIGH | `orchestration-state.md` | Reloads, readiness, queues, cache coordination, concurrency |
| HIGH | `testing.md` | Writing tests for Effect code or Effect-backed architecture seams |
| MEDIUM | `observability.md` | Logging, traces, spans, metrics, config, diagnostics |
| MEDIUM | `review.md` | Reviewing a PR/branch or doing a broader Effect audit |
| OPTIONAL | `effect-atom.md` | React code using Effect Atom / `@effect-atom/*` |

## Quick reference

- Model subsystems with `Schema.Class` data, `Schema.TaggedErrorClass` errors, `Context.Service` contracts, compositional `Layer` graphs, and `Effect.fn` / `Effect.fnUntraced` operations.
- Keep `Effect.runPromise` at runtime/framework boundaries only.
- Keep `Effect.tryPromise` at unsafe external adapters only.
- Do not use `try/catch` in Effect code, service methods, tool/route callback bodies, or tests around Effects. Use `Effect.try`, `Effect.tryPromise`, `Effect.catch*`, `Effect.result`, or `Effect.exit`.
- Do not throw expected domain failures. Return/yield tagged errors.
- Use `return yield*` for terminal failure/interruption branches.
- Use `Semaphore`, `SynchronizedRef`, `Effect.all(..., { concurrency })`, `Effect.ensuring`, `Clock`, and `TestClock` instead of homemade Promise state and sleeps.
- Test the real seam that can fail in production, not just extracted pure helpers.

## Architecture stance

Do not sprinkle Effect into Promise code. If a subsystem is Effect-native, keep it Effect-native until a framework boundary. If an existing boundary uses another typed result/error abstraction, adapt once at the edge and keep the core coherent. Do not satisfy this rule by writing thin Effect wrappers around Promise helpers; build real service contracts, compose layers, and let programs obtain dependencies from context.

For Effect-native subsystems, the preferred shape is:

1. Schema data and tagged errors.
2. Service contracts for storage/provider/runtime/logging/readiness seams.
3. Effect programs for domain workflows and orchestration.
4. Live layers adapting database clients, external SDKs, runtimes, and framework APIs.
5. `Effect.runPromise` only in route, job, tool, CLI, test, or framework callback boundaries.
6. Integration tests for the real runtime seam when unit tests cannot prove production behavior.

If the design cannot be tested without importing half the application, the seam is probably wrong. Deepen or narrow the module until the test can exercise the real boundary with a small fixture.
