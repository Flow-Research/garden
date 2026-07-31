# VCOS Integration

Read this alongside the matching upstream reference for every Effect change in VCOS. This file adds repository boundaries; it does not replace upstream Effect APIs.

## Refactoring Authority

You may fix or refactor the code around the requested change when that is needed to leave a correct, coherent Effect-owned seam. Do not preserve a weak Promise boundary, dishonest model, unsafe parser, shallow service, duplicated helper, or broken test merely because it already exists nearby.

Carry a necessary refactor through its owned contracts, callers, layers, adapters, and tests instead of adding compatibility glue around the problem. Delete obsolete code made redundant by the change. Keep the expansion tied to the requested behavior; do not rewrite unrelated subsystems. If correctness requires a materially larger product or data-model decision, surface that decision rather than guessing.

## Promise Boundaries

Effect owns domain logic and orchestration. Promise interop is limited to unsafe adapters and framework entrypoints.

Use `Effect.tryPromise` narrowly around Promise-only database, SDK, Web Crypto, platform runtime, actor/RPC, and framework APIs. Map unknown failures into a specific `Schema.TaggedErrorClass` at that adapter. For outgoing HTTP, follow `HTTP_CLIENTS.md` instead of wrapping raw `fetch`.

Use `Effect.runPromise` only where a route, TanStack server function, runtime callback, tool callback, CLI entrypoint, or plain Vitest test must return a Promise. Core helpers, services, loops, and orchestration return Effect.

Keep an async framework callback as a thin wrapper:

```ts
const program = Effect.fn("Document.prepare")(function* (subject: Subject) {
  const store = yield* DocumentStore
  return yield* store.prepare(subject)
})

const handler = async (subject: Subject) =>
  Effect.runPromise(program(subject).pipe(Effect.provide(appLayer)))
```

Do not put domain branching or JavaScript `try/catch` around Effect execution. Use typed recovery inside the program, or `Effect.result` / `Effect.exit` when the boundary must translate failures.

Never destructure a method from an SDK, runtime stub, browser object, or service and call it later; preserve receiver semantics with `object.method(...)` or a closure.

## Contracts And Persistence

- Decode unknown request, SDK, parsed JSON, and DB JSON values once at ingress with Effect Schema.
- Keep decoded values typed through the core; do not re-decode typed values to hide a weak signature.
- Never invent fallback values to force a decode. Model real absence with optional keys, `NullOr`, `Option`, or a tagged variant.
- Encode schema-owned values at wire and database egress. Do not use `JSON.parse(JSON.stringify(...))` or `toPlainJson`.
- Use `drizzle-orm/effect-schema` for Drizzle row contracts. Give JSONB fields named schema-backed payloads rather than generic JSON records.
- TanStack server-function and loader wire values must be plain `Schema.Struct` values. `Schema.Class` instances are not seroval-safe.
- Keep Zod only at an established legacy boundary; do not introduce it into an Effect-owned subsystem.

Use one typed error system inside a subsystem. Do not mix `better-result` with Effect. Expected failures use specific tagged errors with enough operation, provider, tenant, and resource context for recovery and diagnosis. Preserve interruption when handling broad causes.

## Runtime Ownership And Concurrency

Runtime memory is a warm cache, not durable truth. Database or Durable Object state owns durable facts. Put shared state under the runtime whose lifecycle matches the required sharing scope; do not use request- or chat-owned state when reuse must cross requests.

Prefer Effect primitives over Promise coordination:

| Need | Prefer |
| --- | --- |
| Serialize reload or prewarm | `Semaphore.make(1)` and `withPermit` |
| Bound external work | `Effect.all` / `Effect.forEach` with explicit concurrency |
| Effectful state transition | `SynchronizedRef.modifyEffect` |
| Guaranteed cleanup | `Effect.ensuring` or scoped resources |
| Retry and pacing | A bounded `Schedule` over explicitly retryable errors |
| Time-dependent tests | `TestClock` |

Do not use sleeps as readiness signals. Add an awaited readiness operation, `Deferred`, `Queue`, `Latch`, or a test-only observation seam. Name pending state by its cause, such as `reloadReason`, instead of a vague `dirty` flag.

## Observability

Name public and non-trivial operations with stable `Effect.fn("Domain.operation")` labels. Use structured Effect logs and spans for organization, resource, request/run, provider, operation, count, and retry context when useful.

Never log credentials, tokens, full provider payloads, or unnecessary personal data. Keep adapter logging narrow when bridging to an existing logger.

Read config through Effect `Config` or adapt the framework environment once at the boundary. Do not scatter `process.env` reads through Effect core.

## Tests

Test product behavior and the real seam that can regress, not Effect primitives or schema invariants themselves.

When correctness depends on Workers, Durable Objects, Agents SDK facets, actor lifecycle, runtime caches, alarms, reloads, or serialization, use the repository runtime-integration-testing skill and a real workerd/Miniflare test. A Node-only mock cannot prove those behaviors.

Good tests exercise:

- the public Effect program with deliberate test layers;
- specific tagged-error and recovery paths;
- bounded concurrency, interruption, cleanup, and idempotency;
- runtime ownership and cache identity;
- deterministic readiness without sleeps.

## Review Checklist

For an Effect review, report only concrete findings with severity and `file:line` evidence. Check that:

- upstream references and the pinned package support every API used;
- unknown values are decoded at actual trust boundaries;
- services hide real domain or infrastructure seams rather than renaming functions;
- Promises appear only in sanctioned adapters and entrypoints;
- expected failures remain typed and actionable;
- concurrency is explicit and bounded;
- durable state is owned by durable storage;
- logs are structured and non-sensitive;
- tests exercise the production-risk seam.
