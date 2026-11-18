# Garden compatibility seams

The retained packages originate from Executor v1.5.40 commit
`b029643641832ef5f9b0d4ff263d96e1a5b2739c`. Garden applies only these
documented compatibility changes:

1. Unpublished workspace sources import the published v1.5.40 SDK and
   execution packages through their `/core` entrypoints. Published package
   roots expose Promise APIs, while these sources require Effect APIs. Direct
   imports avoid runtime re-export interop failures in Workers and Vitest.
2. `packages/plugins/toolkits/src/server.ts` omits the optional Executor HTTP
   API group and handlers. Garden uses the plugin's SDK storage, extension, and
   policy provider directly and does not ship `@executor-js/api`. Its local
   `ToolkitError` is kept beside that implementation, so the now-unreachable
   HTTP API schema module is not retained.
3. `packages/hosts/cloudflare/src/mcp/agent-session-durable-object.ts` passes
   persisted session metadata directly to the Garden-supplied MCP builder and
   removes the two `@executor-js/api/server` context tags. The builder receives
   the same organization slug and web origin in `SessionMeta`. Cloudflare host
   files import the exact MCP `seams` subpath instead of the package root; this
   avoids loading Executor's generic HTTP envelope, which Garden does not use.
4. The encrypted-secrets entry point omits the exported SQLite repartition
   repair. Garden never ran the pre-fix self-host provider, and the plugin does
   not register that separately exported migration, so retaining it would add
   unreachable boot-repair code to a greenfield D1 deployment.
5. The workspace pins Effect and its companion packages to
   `4.0.0-rc.111` (the pnpm catalog and root overrides must agree). Vite
   dedupes `effect`, and pnpm overrides Executor v1.5.40's beta.59 peer pins
   so the Garden Worker has one Effect runtime.
6. The exact upstream OpenAPI, MCP, and GraphQL preset catalogs are retained
   because v1.5.40's published package exports omit their source-declared
   `/presets` subpaths. The OpenAPI catalog's relative `SpecOverrides` type
   import points at the published plugin `/core` surface, so no additional
   implementation source is copied.
7. The encrypted-secrets provider normalizes `randomBytes` and GCM auth-tag
   results through `Buffer.from` before base64 encoding. Cloudflare Workers
   Types v5 models these Node-compatible values as `Uint8Array`, whose native
   `toString` has no encoding parameter; the byte output is unchanged.
8. The published SDK patch at `patches/@executor-js__sdk@1.5.40.patch`
   suppresses regional callback-domain rebinding only when the saved OAuth
   client's resource is exactly `https://workstream.flowresearch.tech/mcp`.
   Workstream authorization codes and PKCE verifiers must reach the configured
   issuer token endpoint, and refresh must retain that endpoint. Other
   resources keep the SDK's regional-provider behavior.
9. The same SDK patch appends `/.well-known/openid-configuration` after a
   path-bearing issuer, as required by [OpenID Connect Discovery section 4.1](https://openid.net/specs/openid-connect-discovery-1_0.html#ProviderConfig).
   OAuth metadata discovery retains [RFC 8414 section 3](https://www.rfc-editor.org/rfc/rfc8414.html#section-3),
   which inserts its well-known path before the issuer path. Garden's Workstream
   installation requires successful OAuth discovery and reports unavailability
   without offering a manual token template or registering an integration.

Garden aliases only the exact retained entrypoints. The generic MCP serving
envelope and in-memory session host, its browser-approval store, and Executor's
duplicate Cloudflare R2 adapter are not reachable from Garden's Worker and are
therefore omitted.

`apps/web/tsconfig.executor.json` compiles every retained production source
file against these seams. Any future source change must be recorded here.
