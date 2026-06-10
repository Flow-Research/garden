---
name: better-result
description: Use when writing, reviewing, or refactoring TypeScript code that uses better-result, Result<T,E>, Result.gen, Result.try/tryPromise, Result.match, tap/tapBoth, serialization, retry, TaggedError, matchError, or when modeling typed domain outcomes without throws/null sentinels.
references:
  - references/tagged-errors.md
  - opensrc/better-result/README.md
  - opensrc/better-result/src/result.ts
  - opensrc/better-result/src/error.ts
  - opensrc/better-result/src/core.ts
  - opensrc/better-result/src/index.ts
---

# better-result

Use `better-result` as a typed workflow toolkit, not just an error wrapper. Model expected outcomes as `Result.ok(value)` and recoverable failures as `Result.err(error)`. Compose work with `Result.gen`, transform with `map`/`andThen`, observe with `tap`/`tapBoth`, and handle boundaries with `.match()`.

## First step: read bundled opensrc

Before non-trivial work, read the bundled upstream source copied from `dmmulroy/better-result@2.9.2`:

1. `opensrc/better-result/README.md` for the public API and examples.
2. `opensrc/better-result/src/result.ts` for Result methods, generator composition, tap/tapBoth, retry, serialization, partition, and flatten behavior.
3. `opensrc/better-result/src/error.ts` for `TaggedError`, `matchError`, `Panic`, `UnhandledException`, and serialization details.
4. `opensrc/better-result/src/core.ts` and `opensrc/better-result/src/index.ts` for exported types and exact module surface.
5. `node_modules/better-result/dist/index.d.mts` for the installed package type surface in the target project.

Refresh the bundled source when changing this skill or when package version changes. README says `npx opensrc better-result`; with the local CLI use `npx opensrc fetch --cwd <repo> better-result` then `npx opensrc path better-result`, and copy that source into `opensrc/better-result/`.

Do not rely on memory for broad API questions. The opensrc files above are required context. In v2.9.x the useful exports include `Result`, `TaggedError`, `matchError`, `matchErrorPartial`, `isTaggedError`, `Panic`, `isPanic`, `UnhandledException`, `ResultDeserializationError`, and type helpers like `InferOk`, `InferErr`, `SerializedResult`.

## Core mental model

`Result<T, E>` is a discriminated union:

- `Ok<T, E>` carries a success value. Use it for successful work and expected domain outcomes.
- `Err<T, E>` carries a recoverable failure. Use it for failures the caller should handle.
- `Panic` is thrown when callbacks inside Result operations throw. Treat Panic as a code defect, not a business outcome.

Do not collapse product states into booleans, nullable sentinels, or string status checks spread through callers. Return rich Ok values and match at the boundary.

```ts
type CallbackOutcome =
  | { kind: 'connected'; connectorId: string; message: string }
  | { kind: 'degraded'; connectorId: string; message: string }
  | { kind: 'failed'; connectorId: string; message: string }

type CallbackError = DatabaseError | InvalidStateError

const result: Result<CallbackOutcome, CallbackError> = await finishCallback()

return result.match({
  ok: (outcome) => redirectWithOutcome(outcome),
  err: (error) => matchError(error, {
    DatabaseError: () => Response.json({ error: 'Database failed' }, { status: 500 }),
    InvalidStateError: (e) => Response.json({ error: e.message }, { status: 400 }),
  }),
})
```

## When to use which primitive

| Need | Use |
| --- | --- |
| Create success/domain outcome | `Result.ok(value)` |
| Create recoverable failure | `Result.err(error)` |
| Wrap throwing sync code | `Result.try({ try, catch })` |
| Wrap async I/O | `Result.tryPromise({ try, catch })` |
| Chain many dependent steps | `Result.gen(function* () { ... })` |
| Await Result-returning Promise inside generator | `yield* Result.await(promise)` |
| Transform success | `.map()` / `Result.map()` |
| Chain Result-returning success path | `.andThen()` / `.andThenAsync()` |
| Transform error type | `.mapError()` |
| Recover from error | `.tryRecover()` / `.tryRecoverAsync()` |
| Observe success/error without changing value | `.tap()`, `.tapError()`, `.tapBoth()` |
| Async observation | `.tapAsync()`, `.tapErrorAsync()`, `.tapBothAsync()` |
| Branch at boundary | `.match({ ok, err })` / `Result.match()` |
| Exhaustively match tagged error union | `matchError(error, handlers)` |
| Partial error handling | `matchErrorPartial(error, handlers, fallback)` |
| Send over RPC/server action/storage | `Result.serialize()` / `Result.deserialize()` |
| Split arrays of results | `Result.partition(results)` |
| Flatten nested result | `Result.flatten(result)` |
| Extract types | `InferOk<typeof result>`, `InferErr<typeof result>` |

## Modeling outcomes

Use `Ok` for rich domain outcomes even when some outcomes are not “happy path”. Example: a connector callback can legitimately finish as `connected`, `degraded`, or provider-reported `failed`. Those are product outcomes the UI can render. They are not all infrastructure errors.

Use `Err` when the operation could not produce a trustworthy outcome: invalid state, authorization failure, database write failed, malformed callback, or an external dependency required for persistence failed.

```ts
type SyncOutcome =
  | { kind: 'synced'; toolCount: number }
  | { kind: 'degraded'; reason: string }

function toOutcome(sync: Result<Tool[], CapabilitySyncError>): Result<SyncOutcome, never> {
  return sync.match({
    ok: (tools) => Result.ok({ kind: 'synced', toolCount: tools.length }),
    err: (error) => Result.ok({ kind: 'degraded', reason: error.message }),
  })
}
```

At UI/API boundaries, match once and keep rendering logic explicit.

## Composition with `Result.gen`

Use `Result.gen` when multiple steps depend on earlier values or when conditional branches need readable imperative code.

```ts
async function finishCallback(input: CallbackInput) {
  return Result.gen(async function* () {
    const state = yield* parseState(input.state)
    const membership = yield* Result.await(findMembership(state))
    const account = yield* Result.await(saveAccount(state, input))

    const sync = yield* Result.await(syncCapabilities(account))
    const outcome = sync.match({
      ok: () => ({ kind: 'connected' as const, connectorId: account.connectorId }),
      err: (error) => ({
        kind: 'degraded' as const,
        connectorId: account.connectorId,
        message: error.message,
      }),
    })

    const event = yield* Result.await(recordCallbackEvent(outcome))
    return Result.ok({ outcome, event })
  })
}
```

`yield*` unwraps `Ok`; `Err` short-circuits. You can also `yield* new TaggedError(...)` directly to short-circuit with that error.

## Boundary pattern

Return `Result` from internal functions. Convert to HTTP/UI/side effects at the edge.

```ts
const result = await finishCallback(request)

return result.match({
  ok: ({ outcome }) => outcome.kind === 'failed'
    ? redirectToWorkspace(outcome)
    : redirectToWorkspace(outcome),
  err: (error) => matchError(error, {
    InvalidStateError: (e) => badRequest(e.message),
    UnauthorizedCallbackError: () => unauthorized(),
    DatabaseError: () => Response.json({ error: 'Persistence failed' }, { status: 500 }),
  }),
})
```

If branching on `outcome.kind` grows, extract small outcome handlers. Do not push status booleans through unrelated code.

## Observability and side effects

Use `tap`/`tapError`/`tapBoth` when logging, metrics, cache invalidation, or event emission should not change the result.

```ts
const result = await Result.tapBothAsync(await finishCallback(input), {
  ok: async ({ outcome }) => metrics.increment(`connector.${outcome.kind}`),
  err: async (error) => metrics.increment(`connector.error.${error._tag}`),
})
```

Use `tapBoth` for symmetric observation. Use `tap` only for success and `tapError` only for error.

## Retry

Use retry only at I/O boundaries where repeating is safe. The `try` callback can receive an attempt context in current versions.

```ts
const response = await Result.tryPromise(
  {
    try: ({ attempt }) => fetchWithAttempt(url, attempt),
    catch: (cause) =>
      cause instanceof TypeError
        ? new RetryableNetworkError({ cause, message: cause.message })
        : new FatalNetworkError({ cause, message: String(cause) }),
  },
  {
    retry: {
      times: 3,
      delayMs: 100,
      backoff: 'exponential',
      shouldRetry: (error) => error._tag === 'RetryableNetworkError',
    },
  },
)
```

Do not retry non-idempotent writes unless the operation has an idempotency key.

## Serialization

Use `Result.serialize` at RPC/server-action boundaries where class instances cannot cross cleanly. Rehydrate with `Result.deserialize` on the other side.

```ts
async function action(): Promise<SerializedResult<User, ValidationError>> {
  return Result.serialize(await createUser())
}

const result = Result.deserialize<User, ValidationError>(await action())
```

Remember that deserialized tagged errors may need explicit rehydration if the transport stripped prototypes. Confirm behavior from installed source before depending on class static guards across process boundaries.

## Tagged errors

Read `references/tagged-errors.md` when defining or reviewing error classes. Use `matchError` for exhaustive matching of `Err` variants.

Prefer props with enough context:

```ts
class DatabaseError extends TaggedError('DatabaseError')<{
  operation: 'insert' | 'select' | 'update'
  message: string
  cause: unknown
}>() {}
```

## Common mistakes

- Treating `better-result` as only a try/catch migration tool. It also models successful domain outcomes, observation, retry, serialization, and composition.
- Returning `Err` for product states the UI should display as normal outcomes. Use `Ok` with a discriminated outcome union.
- Spreading `isErr()` / `isOk()` checks everywhere. Compose with `Result.gen`, `andThen`, and match once at the boundary.
- Using nullable or boolean sentinels when a typed `Result` or `Ok` outcome union would explain the state.
- Catching `Panic` as business logic. Panic means a callback threw; fix the defect.
- Ignoring installed source. Always verify exact APIs from `node_modules/better-result/dist/index.d.mts` or opensrc before using less common helpers.

## References

| File | Purpose |
| --- | --- |
| `references/tagged-errors.md` | TaggedError definitions, matching, type guards |
| `opensrc/better-result/README.md` | Upstream public docs and API examples |
| `opensrc/better-result/src/result.ts` | Result methods, Result.gen/await, retry, tap/tapBoth, serialization, partition, flatten |
| `opensrc/better-result/src/error.ts` | TaggedError, matchError, Panic, UnhandledException |
| `opensrc/better-result/src/core.ts` | Ok/Err classes and core type helpers |
| `opensrc/better-result/src/index.ts` | Exact upstream exports |
| `node_modules/better-result/dist/index.d.mts` | Exact installed type surface in the consuming project |
