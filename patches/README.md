# Dependency patches

pnpm applies these through `pnpm.patchedDependencies` in the root
`package.json`. Each patch pins one exact version, so bumping that package
requires regenerating or dropping its patch (`pnpm patch <pkg>@<version>`).
Check the removal condition first: a patch that is no longer needed should be
deleted, not carried forward.

| Patch | What it changes | Why | Remove when |
| --- | --- | --- | --- |
| `@executor-js__sdk@1.5.40.patch` | Renames `Schema.TaggedErrorClass` to `Schema.TaggedError` across the SDK's error classes | Executor 1.5.40 is built against an Effect beta that had `TaggedErrorClass`; the workspace runs Effect `4.0.0-rc.111` (see the root `pnpm.overrides` and `third_party/executor/PATCHES.md`), where it is `TaggedError` | Executor publishes a release built against the Effect release the workspace uses |
| `@executor-js__config@1.5.40.patch` | Same rename for `ConfigParseError` and `LoadPluginsError` | Same as above | Same as above |
| `@executor-js__plugin-graphql@1.5.40.patch` | Same rename for the GraphQL plugin errors | Same as above | Same as above |
| `@executor-js__plugin-mcp@1.5.40.patch` | Same rename for the MCP plugin errors | Same as above | Same as above |
| `@executor-js__plugin-openapi@1.5.40.patch` | Same rename for the OpenAPI plugin errors | Same as above | Same as above |
| `@helix-db__helix-db@3.0.2.patch` | Replaces `new Function("specifier", "return import(specifier)")` with a plain `import()` in `graph.js` and `index.js` | Cloudflare Workers forbid code generation from strings (`new Function`/`eval`), so the client cannot load in the Worker unpatched | The Helix client stops constructing functions from strings |
| `agents@0.17.3.patch` | Changes replay, delivery acknowledgement, Durable Object storage handling, SSE rotation and priming-event behaviour in the MCP session runtime (`dist/mcp`) | Garden's MCP sessions depend on these fixes; see `THIRD_PARTY_NOTICES.md` | Upstream `agents` ships equivalent behaviour; diff the patch against the new release before dropping it |
