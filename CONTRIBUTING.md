# Contributing

## Connectors

Connector changes follow the policy in [docs/core/connectors.md](docs/core/connectors.md).

Before opening a PR:

- Run `pnpm verify:connectors`.
- Run `pnpm --filter @garden/connectors typecheck`.
- Run `pnpm --filter @garden/connectors test`.
- Follow the documented Executor-hosted or Garden-native contribution path;
  there is no connector scaffolding command.
- Check the review checklist in [docs/core/connectors.md](docs/core/connectors.md#review-checklist).
