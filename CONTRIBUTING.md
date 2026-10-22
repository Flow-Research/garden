# Contributing

Thanks for helping improve Garden.

## Development

Follow the [developer onboarding guide](docs/development/onboarding.md) for a
complete local setup and system walkthrough. The shorter setup path remains in
[README.md](README.md#run-garden-locally).

Run the checks relevant to your change. The full test suite starts Postgres 16
through Testcontainers, so Docker must be running. Before opening a pull
request, run the same main checks as CI:

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm verify:deploy-config
```

`pnpm format:write` fixes formatting. Lint errors fail CI; lint warnings are a
burn-down list, so do not add new ones.

Keep pull requests focused. Include tests for behavior changes, update shared
schemas before their consumers, and never commit credentials or local resource
overlays.

## Code conventions

The October 2026 audit ([docs/audit](docs/audit/2026-10-codebase-audit.md))
found several competing patterns for the same job. New code follows one:

- **No `any`.** Lint rejects it, tests included. Type unknown input as
  `unknown` and narrow it, or validate it with a schema.
- **No unchecked casts of external data.** Validate request bodies, RPC
  results and third-party responses instead of casting them with `as`.
- **Errors in app and service code:** return a better-result `Result` with a
  `TaggedError` that carries a typed `code`. Do not `throw new Error(...)` for
  expected failures, and do not use `null` to mean "failed". Effect-based
  subsystems (brain, connectors, executor engine, document engine) keep using
  Effect errors and convert to `Result` at their boundary.
- **API routes:** map service errors with `serviceErrorResponse()`
  (`db_error` becomes a generic 503, never the raw database message). Every
  route that changes data checks the matching workspace permission with
  `requireWorkspacePermission()`, and checks that any ID taken from the body
  belongs to the workspace (`isWorkspaceParticipant()`, `isWorkspaceIssue()`).
- **User-supplied files** are served with `storedObjectHeaders()`, never with
  the stored content type inline.
- **Database writes:** use the request-scoped `appContext.db()`. Use
  `requireReturnedRow()` for `INSERT … RETURNING` results instead of
  destructuring an array that might be empty.
- **Migrations:** generate them with `pnpm --filter @garden/db db:generate`.
  Never edit a migration or the journal after it has been applied; write a new
  migration instead.
- **Links to app pages** use the route helpers (for example `issuePath()`) and
  navigate through `useNavigation()`, not hand-built strings or window events.
- **Design tokens:** use the semantic token classes (for example
  `text-muted-foreground`), not raw palette classes, hex colours or arbitrary
  `[color:var(--…)]` values.

Two choices are still open for maintainers: whether request validation
converges on zod or Effect Schema, and which single icon library the app uses.
Until they are decided, follow the surrounding code.

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
