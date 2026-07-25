# Skills HTTP architecture: Effect HttpApi inside TanStack Start

Status: implemented on `fix/skills-install-visibility`; focused verification complete

## Decision

Garden will implement the skills HTTP surface as one Effect `HttpApi` mounted behind a TanStack Start splat server route.

```text
Cloudflare Worker request
  -> TanStack Start server entry and request context
  -> createFileRoute('/api/$').server.handlers
  -> one Effect HttpApi web handler
  -> Skills HttpApi group
  -> request-scoped application Layer
  -> Skills service
  -> Garden AppRequestContext database provider
```

Ownership stays explicit:

| Concern | Owner |
|---|---|
| Worker integration, route hosting, SSR, hydration | TanStack Start |
| HTTP contracts, validation, response encoding, typed errors, generated clients | Effect HttpApi |
| Application composition | Effect services and Layers |
| Cache, invalidation, optimistic state, prefetch, dehydration | TanStack Query |
| Request-local database resources | Garden `AppRequestContext` |

## Rejected design

Do not create a transport Effect and `runApiEffect` call for every endpoint.

```text
Rejected:
TanStack route
  -> endpoint-specific transport Effect
  -> custom runApiEffect
  -> manual request decoding
  -> manual error/status switch
  -> manual Response.json
```

Effect HttpApi already owns those concerns and exposes the complete application for raw HTTP testing.

Also rejected:

- TanStack `createServerFn` for the skills API
- a feature-owned PostgreSQL client or Effect SQL pool
- module-global request services or request-created I/O
- manual `Schema.encodeEffect` in endpoint handlers
- one custom Promise adapter per endpoint
- FiberRef or mutable-global request context when explicit request context is available

## Canonical API contract

A shared contract defines method, path, inputs, success schema, and declared errors once.

```ts
export class SkillsApiGroup extends HttpApiGroup.make('skills')
  .add(
    HttpApiEndpoint.get('list', '/api/skills', {
      success: Schema.Array(Skill),
    }),
  )
  .add(
    HttpApiEndpoint.post('create', '/api/skills', {
      payload: CreateSkillInput,
      success: Skill,
      error: SkillConflictError.pipe(HttpApiSchema.status(409)),
    }),
  ) {}
```

Effect HttpApi then:

1. Decodes path, query, headers, and payload using declared schemas.
2. Supplies typed handler inputs; domain code does not receive `unknown`.
3. Runs the endpoint handler Effect.
4. Encodes declared success and error values.
5. Produces the Web `Response` with declared status and content type.
6. Derives a typed client from the same contract.

Domain error classes remain HTTP-independent. The API contract may annotate their schemas with HTTP statuses without putting `Request`, `Response`, or status codes inside `Skills`.

Effect Schema is the canonical public model. Derive API TypeScript types from schemas rather than maintaining separate `Skill`, `SkillWire`, and transport interfaces.

## Handler and service composition

Endpoint implementations form one `HttpApiBuilder.group` Layer and yield application services directly.

```ts
export const SkillsApiLive = HttpApiBuilder.group(
  GardenApi,
  'skills',
  (handlers) =>
    handlers
      .handle('list', () =>
        Effect.gen(function* () {
          const skills = yield* Skills
          return yield* skills.list()
        }),
      )
      .handle('create', ({ payload }) =>
        Effect.gen(function* () {
          const skills = yield* Skills
          return yield* skills.create(payload)
        }),
      ),
)
```

There is no endpoint-local infrastructure construction. `Skills`, `Database`, workspace access, bundle storage, and outbound HTTP are supplied through Layers.

## Request-scoped Worker context and database

Cloudflare may reuse one isolate for concurrent requests, but request-created I/O cannot cross invocation boundaries. Garden therefore retains the existing request owner:

```text
AppRequestContext
  -> env
  -> Request
  -> auth state
  -> db() provider
  -> centralized cleanup
```

Garden's installed `effect@4.0.0-beta.85` supports request requirements on `HttpRouter.toWebHandler`. Garden leaves `Skills` as that request requirement. The TanStack route builds `requestSkillsLayer` from the current `AppRequestContext`, then passes the resulting Effect `Context` into the static web handler.

`HttpRouter.provideRequest(layer)` remains useful when a request Layer has no ordinary input. Garden's Layer needs the TanStack-owned `AppRequest`, so building that Layer in the route keeps ownership explicit and avoids caching request I/O. `HttpApiMiddleware` remains available for true middleware concerns.

`Database` borrows the existing `AppRequestContext.db()` value. It does not create another client, pool, or lifecycle.

```text
static module scope
  -> schemas
  -> service tags
  -> Layer recipes
  -> API contract and router configuration

per request
  -> AppRequest service
  -> Database service borrowing context.db()
  -> Skills service and endpoint execution
```

## TanStack route mount

The route remains a real TanStack Start server route. Its route configuration stays literal and inline for TanStack static analysis.

```ts
const handleSkillsApi = async ({ request, context }) => {
  const appContext = requireAppRequestContext(context)
  const effectContext = await makeSkillsRequestContext(appContext)
  return skillsApiWebHandler(request, effectContext)
}

export const Route = createFileRoute('/api/$')({
  server: {
    handlers: {
      GET: handleSkillsApi,
      POST: handleSkillsApi,
      PUT: handleSkillsApi,
      PATCH: handleSkillsApi,
      DELETE: handleSkillsApi,
    },
  },
})
```

The exact request-context type will be inferred from the final request Layer. Server-only API construction belongs in a `.server.ts` module so TanStack import protection excludes it from browser bundles.

Existing exact `/api/...` TanStack routes may coexist during migration; the splat handles unmatched migrated endpoints. Integration tests must cover route precedence and `/api/skills` root matching.

No Garden function named `runApiEffect` is required. `HttpRouter.toWebHandler` is the single server execution boundary.

## TanStack Query and the Promise boundary

TanStack Query requires `queryFn` and `mutationFn` to return Promises. Generated Effect HttpApi client methods return lazy `Effect` values. One Promise boundary is therefore required in the client/query integration.

```text
HttpApi generated client method
  -> Effect<Success, DeclaredError>
  -> shared client ManagedRuntime or Effect Query adapter
  -> Promise<Success>
  -> TanStack Query
```

This does not weaken the Effect architecture. TanStack Query owns Promise scheduling and cancellation; the shared adapter executes the Effect and forwards Query's `AbortSignal`. The mistake would be duplicating that adapter in every endpoint or query.

Garden uses the minimal shared adapter in `apps/web/src/lib/api/skills.ts`. One browser `ManagedRuntime` owns `FetchHttpClient`; one `runClientEffect` function executes generated-client Effects and forwards TanStack Query's `AbortSignal`. No endpoint has its own runner.

`effect-query` was not added. It provides a broader version of this bridge, but its wrapped failures complicate TanStack Router `redirect()` and `notFound()` sentinels in loaders. Garden does not need that abstraction for the current skills queries.

TanStack Query retains all current responsibilities:

- existing query keys and hierarchical invalidation
- optimistic updates
- cache freshness
- `ensureQueryData` prefetching
- dehydration and hydration

API success values stored in Query must remain JSON-safe plain data. API routes use HTTP JSON. TanStack/Seroval participates separately when Query state is dehydrated for SSR; it is not the raw API transport.

### Browser and SSR clients

The browser generated client can use the current origin and cookies naturally. SSR calls need either:

- an absolute base URL plus explicit request header/cookie forwarding, or
- a direct in-process client that invokes the same HttpApi handlers without an HTTP round trip.

`effect-tanstack-start` demonstrates both browser HTTP and direct SSR clients. Garden should not adopt its direct client until the request-context and database ownership path is proven, because its current mount helper supplies process-level runtime context rather than Garden's `AppRequestContext`.

## Testing model

### Contract and in-memory API tests

Effect `HttpApiTest.groups` exercises the same request encoding, handler routing, response encoding, and client decoding pipeline without starting an HTTP server.

```ts
const client = yield* HttpApiTest.groups(GardenApi, ['skills']).pipe(
  Effect.provide(SkillsApiLive),
  Effect.provide(TestSkillsLayer),
)

const created = yield* client.skills.create({ payload: validInput })
```

Use it for schema round trips, declared errors, endpoint handlers, middleware, and dependency replacement.

### Raw Web Request/Response tests

Compose the real API with test Layers, build the web handler, and send a real `Request`.

```ts
const TestApiLive = ApiLive.pipe(
  Layer.provide(TestSkillsLayer),
  Layer.provide(TestRequestLayer),
)

const { handler } = HttpRouter.toWebHandler(TestApiLive)
const response = await handler(
  new Request('http://localhost/api/skills', {
    method: 'POST',
    body: JSON.stringify(input),
  }),
)
```

Assert status, headers, and body. This covers malformed JSON, schema failures, authentication, declared 404/409 behavior, and successful encoding through the production HTTP surface.

Effect beta.85 currently turns JSON parse failures into defects before `HttpApiSchemaError.wrap`, producing 500 instead of the documented 400 response. Garden adds one API-wide router middleware that converts only `SyntaxError` defects from malformed JSON into 400. This can be removed when the installed Effect decoder handles malformed JSON as a schema error.

### TanStack mount tests

A smaller integration suite verifies that `/api/$` forwards method, body, headers, and request context and that exact legacy routes retain precedence during incremental migration.

## Serialization rules

- Decode untrusted request, external API, and uncertain database values at the owning boundary.
- Keep public success/error schemas JSON-safe.
- Let Effect HttpApi perform success/error encoding.
- Do not manually call `Schema.encodeEffect` inside handlers.
- Retain Garden's existing `toSkill` conversion because a Drizzle row genuinely differs from the public model. Relocate/type it against the canonical schema rather than adding a duplicate mapper.
- Declare every public field in the schema. `Schema.Struct` strips undeclared fields during encoding.
- Use `{ onExcessProperty: 'error' }` at inputs where unknown request keys must fail rather than be ignored.

## Evidence and caveats

### `EthanShoeDev/effect-tanstack-start` (`1bd973c`)

Strongest direct TanStack Start precedent:

- mounts Effect HttpApi at `createFileRoute('/api/$')`
- uses one `HttpRouter.toWebHandler`-backed handler for all methods
- derives browser and SSR clients from one contract
- keeps route configuration inline for TanStack static analysis
- supports a direct SSR client to avoid an HTTP round trip

Caveat: its current `mountApi` accepts only `{ request }` and supplies a process-level runtime context. Garden cannot use it unchanged because Garden needs request-owned `AppRequestContext` and database services.

### `lucas-barake/effect-tanstack-start` (`cfe963a`)

Concrete application precedent:

- combines HttpApi, Effect RPC, and health routes behind one TanStack `/api/$` route
- separates the API contract from `HttpApiBuilder.group` implementations
- uses one generated client service
- demonstrates that TanStack Start only needs the final Web handler

Caveat: its todo service is static and does not solve Garden's request-owned database problem. It also uses older Effect package APIs.

### `backpine/effect-worker` (`fcaf8fb`)

Cloudflare request-scope precedent:

- keeps router/middleware definitions in a shared runtime
- uses `HttpApiMiddleware` with `provides` for per-request services
- documents why database I/O must not be memoized between Worker requests
- distinguishes static middleware implementation from per-request middleware execution

Caveat: historical design notes in the repository predate parts of its current implementation. Installed Effect source and current Cloudflare docs win where they differ.

### `voidhashcom/effect-query` (`f2155da`)

TanStack Query bridge precedent:

- converts Effects into standard Query option objects
- executes through one `ManagedRuntime`
- forwards TanStack cancellation to Effect
- documents HttpApi and RPC client usage

Caveat: wrapped failures require deliberate handling for Router loader `redirect()` and `notFound()` sentinels.

### Effect upstream (`4ac7e8b`) and Garden-installed Effect

Official source confirms:

- `HttpApiTest.groups` is intended for typed handler/schema/middleware tests
- `HttpRouter.provideRequest` supplies Layers at request scope
- `HttpRouter.toWebHandler` accepts request context for unresolved request services
- `HttpApiBuilder` performs input decoding and success/error encoding

Examples often use older `@effect/platform` APIs. Implementation must follow Garden's installed Effect beta.85 signatures.

### Less-direct references

- `kevin-courbet/tanstack-effect-example`: same TanStack splat pattern for Effect RPC and replaceable service Layers.
- `bitswired/quick-effect-tanstack-boilerplate`: separate Bun HttpApi service with a TanStack Query frontend; compatible libraries but wrong deployment shape.
- `mguleryuz/tanstack-effect`: generated Query hooks from HttpApi; broad third-party abstraction, not required.
- `shekohex/tanstack-start-effect-template`: useful schema/service organization, but separate API process and different DB ownership.

## Implementation checkpoints

1. [x] Compile the Garden HttpApi group and raw web handler against beta.85.
2. [x] Build `Database` and `Skills` from the current `AppRequestContext`; no request Layer or DB client is cached globally.
3. [x] Exercise `HttpApiTest.groups` and raw `Request` tests with replacement `Skills` services.
4. [x] Verify malformed input, success statuses, no-content responses, and declared authorization errors.
5. [x] Use the generated client with hierarchical Query keys, shared cancellation-aware execution, and JSON-safe success values.
6. [x] Migrate skills routes and remove duplicate transport types and manual response plumbing.
7. [ ] Run authenticated live browser flows once the branch's unrelated connector-proxy build baseline is repaired.

## Sources

- https://github.com/EthanShoeDev/effect-tanstack-start
- https://github.com/lucas-barake/effect-tanstack-start
- https://github.com/backpine/effect-worker
- https://github.com/voidhashcom/effect-query
- https://github.com/kevin-courbet/tanstack-effect-example
- https://github.com/Effect-TS/effect/tree/main/packages/effect/src/unstable/httpapi
- https://tanstack.com/start/latest/docs/framework/react/guide/server-routes
- https://tanstack.com/query/latest/docs/framework/react/guides/ssr
- https://developers.cloudflare.com/hyperdrive/concepts/connection-lifecycle/
