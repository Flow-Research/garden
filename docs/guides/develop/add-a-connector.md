---
title: Add a connector
description: Steps and checks to add an Executor-hosted or Garden-native integration to Garden.
status: current
owner: "@Flow-Research/security"
last_reviewed: 2026-11-03
---

No scaffolding command exists for connectors. Pick the path that matches the integration. For how connectors work, see [connectors](../../concepts/architecture/connectors.md).

## Add an Executor-hosted integration

Use this path for most integrations. Executor runs the transport.

1. Look for an upstream Executor preset or an integrations.sh catalog entry. Use it instead of adding a Garden-specific transport.
2. If Garden needs extra catalog metadata or a curated preset, update `apps/web/src/lib/server/executor-engine/presets.ts` or `catalog.ts` and the tests beside them.
3. If Garden needs workspace availability, scope, or risk metadata for the provider, add or update `packages/connectors/src/<id>/connector.ts`.
4. Run the registry, install preview, OAuth, and connection ownership tests in `apps/web/src/lib/server/executor-engine/`.

## Add a Garden-native integration

Use this path only when Garden owns the provider installation and the typed API client, as it does for GitHub and Discord.

1. Add `packages/connectors/src/<id>/connector.ts`. Define the tools beside it with Effect Schema and `defineNativeConnectorTool`. Use `packages/connectors/src/discord/` as the model.
2. Write the provider client as an Effect service. Keep credentials at the host boundary. Declare the smallest OAuth scopes and API hosts that work.
3. Register the connector in `packages/connectors/src/registry.ts`. Add any package exports it needs.
4. Add the provider to Executor's Garden catalog projection. Wire its installation and availability boundary in the web app.
5. Add unit tests for schema decoding, provider failures, risk metadata, installation ownership, and runtime exposure.

Do not add a standalone Worker or duplicate Executor's integration engine.

## Run the checks

Before you open a connector PR, run these commands:

```bash
pnpm verify:connectors
pnpm --filter @garden/connectors typecheck
pnpm --filter @garden/connectors test
pnpm --filter @garden/agent-runtime typecheck
pnpm --filter @garden/web test
```

`pnpm verify:connectors` runs `packages/connectors/scripts/verify-connector-coverage.ts`. CI runs it in `.github/workflows/ci.yml`.

## Review the PR against this list

Check each item before you ask for review:

- The change uses Executor or a justified Garden-native client. It does not add another connector Worker.
- OAuth scopes and API hosts are minimal and explicit.
- Every exposed tool has an honest risk class and its required scopes.
- Unknown tools fail closed instead of getting a permissive default.
- Workspace and member ownership is checked at the API and execution boundaries.
- Credentials and personal data never appear in logs, tool descriptions, or fixtures.
- Registry, install, execution, approval, and failure paths have tests.
