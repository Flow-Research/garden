# Connectors

How Garden installs external integrations, exposes their tools to agents, and
accepts connector contributions.

## Runtime model

Garden has one application Worker. Connector catalog, installation, OAuth,
connections, execution, and hibernatable MCP sessions run through Executor
v1.5.40 inside that Worker. Garden API routes call the public Executor SDK
directly; the Worker also exports Executor's MCP session and execution-owner
Durable Objects. There is no Harnessy bundle, connector service binding, or
separate MCP-proxy Worker.

Garden keeps the product-specific layer:

- workspace identity, connection UI, permission grants, approvals, and audit;
- provider policy and native tool definitions in `packages/connectors/src`;
- Garden-owned GitHub App and Discord bot installation flows; and
- catalog projection and Garden presets under
  `apps/web/src/lib/server/executor-engine`.

Executor owns the reusable integration engine and remote MCP/OpenAPI/GraphQL
execution. Native GitHub and Discord tools execute through typed Effect
services in Garden; the remaining installed integration tools arrive through
the single Executor MCP session.

## Storage and authorization

Executor stores integration and connection state in its D1 binding and blobs in
R2. Garden's Neon Postgres database stores workspace product state such as
accounts/installations, capabilities, permission grants, approval requests, and
tool-call audit rows. Durable Objects keep agent and MCP session state.

Each tool is classified as `read`, `write`, `send_external`, or `destructive`.
The per-agent trust level is `auto`, `allow`, or `ask`. Unclassified native or
hosted GitHub tools are not exposed. Executor receives tenant/member identity
from Garden and never replaces Garden's workspace authorization checks.

## Contributing an integration

No connector scaffolding command exists. Choose the path that matches the
integration:

### Executor-hosted integration

1. Prefer an upstream Executor preset or integrations.sh catalog entry instead
   of adding a Garden-specific transport.
2. If Garden needs additional catalog metadata or a curated preset, update
   `apps/web/src/lib/server/executor-engine/presets.ts` or `catalog.ts` and its
   adjacent tests.
3. Add or update the provider policy manifest under
   `packages/connectors/src/<id>/connector.ts` only when Garden needs
   workspace availability, scope, or risk metadata for that provider.
4. Exercise registry, install preview, OAuth, and connection ownership tests.

### Garden-native integration

Use this only when Garden owns the provider installation and typed API adapter,
as it does for GitHub and Discord.

1. Add `packages/connectors/src/<id>/connector.ts` and define tools beside it
   with Effect Schema and `defineNativeConnectorTool`.
2. Implement the provider client as an Effect service; keep credentials at the
   host boundary and declare minimal scopes and API hosts.
3. Register the connector in `packages/connectors/src/registry.ts` and add any
   required package exports.
4. Add the native provider to Executor's Garden catalog projection and wire its
   installation/availability boundary in the web app.
5. Add unit tests for schema decoding, provider failures, risk metadata,
   installation ownership, and runtime exposure.

Do not add a standalone Worker, duplicate Executor's integration engine, or
route connector execution through Harnessy.

## Required checks

Before opening a connector PR, run:

```bash
pnpm verify:connectors
pnpm --filter @garden/connectors typecheck
pnpm --filter @garden/connectors test
pnpm --filter @garden/agent-runtime typecheck
pnpm --filter @garden/web test
```

The connector workflow watches `packages/connectors`, the Executor engine/API
paths, the runtime MCP controller, and dependency metadata.

## Review checklist

- [ ] The implementation uses Executor or a justified Garden-native adapter;
      it does not introduce another connector Worker.
- [ ] OAuth scopes and API hosts are minimal and explicit.
- [ ] Every exposed tool has an honest risk class and required scopes.
- [ ] Unknown tools fail closed instead of inheriting a permissive default.
- [ ] Workspace/member ownership is checked at API and execution boundaries.
- [ ] Credentials and PII never enter logs, tool descriptions, or fixtures.
- [ ] Registry, install, execution, approval, and failure paths have tests.
