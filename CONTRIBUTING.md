# Contributing

## Connectors

Connector changes follow the policy in [docs/core/connectors.md](docs/core/connectors.md).

Before opening a PR:

- Run `pnpm verify:connectors`.
- Run `pnpm --filter @garden/connectors typecheck`.
- Run `pnpm --filter @garden/connectors test`.
- Use `pnpm create garden-connector <id>` when starting a new connector manifest.
- Check the review checklist in [docs/core/connectors.md](docs/core/connectors.md#review-checklist).
