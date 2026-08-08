# Vendored Executor host sources

These files are the retained production closure from UsefulSoftwareCo/executor
commit `b029643641832ef5f9b0d4ff263d96e1a5b2739c` (release v1.5.40), copied on
2026-08-07 because the production host packages are private and unpublished.

Included production-source closures:

- MCP tool server, artifact helpers, browser-approval parser, and resource seams
- Cloudflare MCP Durable Object, headers, alarm policy, owner directory, and stub
- `packages/kernel/runtime-dynamic-worker`
- encrypted-secrets provider
- toolkit storage, extension, and policy provider
- OpenAPI, MCP, and GraphQL preset catalogs missing from published exports

The generic MCP HTTP envelope and in-memory host, duplicate Cloudflare blob
adapter, unused encrypted-secrets repair, toolkit HTTP API schemas, tests,
changelogs, build configuration, and browser-only toolkit UI files are
intentionally omitted. They remain available in the
[`UsefulSoftwareCo/executor`](https://github.com/UsefulSoftwareCo/executor/tree/b029643641832ef5f9b0d4ff263d96e1a5b2739c)
upstream tree and are not part of the Garden Worker module graph.

Published Executor SDK, execution, codemode, FumaDB, OpenAPI, MCP, and GraphQL
packages remain npm dependencies; only the three unpublished preset entrypoints
are copied from those plugin packages. Garden does not vendor
`@executor-js/api`; it constructs Executor directly from
`@executor-js/sdk/core`.

Garden's direct `/core` import adjustments and host-removal patches are
documented in `PATCHES.md`. All other retained package files match upstream.
`LICENSE` is the upstream MIT license copied from the same commit.
