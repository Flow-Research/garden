# Contributing

Thanks for helping improve Garden.

## Development

Follow the setup instructions in [README.md](README.md#run-garden-locally), then
run the checks relevant to your change. The full test suite starts Postgres 16
through Testcontainers, so Docker must be running. Before opening a pull
request, run the same main checks as CI:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Keep pull requests focused. Include tests for behavior changes, update shared
schemas before their consumers, and never commit credentials or local resource
overlays.

By submitting a contribution, you agree that it is licensed under Garden's
[AGPL-3.0-only license](LICENSE). Preserve upstream notices when adapting
third-party code.

## Connectors

Connector changes follow the policy in [docs/core/connectors.md](docs/core/connectors.md).

Before opening a PR:

- Run `pnpm verify:connectors`.
- Run `pnpm --filter @garden/connectors typecheck`.
- Run `pnpm --filter @garden/connectors test`.
- Follow the documented Executor-hosted or Garden-native contribution path;
  there is no connector scaffolding command.
- Check the review checklist in [docs/core/connectors.md](docs/core/connectors.md#review-checklist).

## Security

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
