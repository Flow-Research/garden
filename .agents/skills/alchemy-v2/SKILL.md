---
name: alchemy-v2
description: Review, migrate, or change Garden infrastructure that uses Alchemy v2. Use for alchemy.run.ts, Alchemy CLI commands, resource adoption, state, stages, deploy scripts, or the Alchemy v1-to-v2 migration. Do not use for ordinary local app development.
---

# Alchemy v2 in Garden

Use current evidence. Alchemy v2 can change during prerelease development, so do not rely on remembered APIs or a copied documentation snapshot.

## Source order

Before planning or changing code, check these sources in order:

1. The version in the target branch's root `package.json` and lockfile.
2. That exact package version's source and declarations under `node_modules/alchemy` after installation.
3. Current official Alchemy documentation at `https://alchemy.run`.
4. The official source and changelog at `https://github.com/alchemy-run/alchemy` when the docs and installed package differ.

State the exact Alchemy version used for the decision. Treat the installed package as the API authority for pinned-version code.

## Garden migration rules

- Read the repo-local `deploy` skill before deployment, teardown, or remote verification.
- Treat `garden-staging` as production even though its name contains `staging`.
- Test infrastructure changes against the preview target first.
- Pass the stage with the CLI's documented `--stage` option. Do not assume an environment variable selects it.
- Use `--adopt` only for the planned operation that takes ownership of existing resources. Do not leave it on teardown commands or routine deployment scripts without a verified reason.
- Inspect the proposed plan for replacement or deletion of existing D1, R2, Hyperdrive, Durable Object, Workflow, Container, and Worker resources before applying it.
- Stop if preview targets a production resource or if Alchemy proposes an unexpected deletion or replacement.
- Do not infer that Alchemy v1 state will migrate. Verify the v2 state store and adoption behavior for the pinned version.
- Run `pnpm run verify:deploy-config` after changes to deployment metadata, bindings, stages, or package scripts.
- Do not deploy production unless Samuel explicitly requests it.

## Review boundary

Keep the infrastructure migration separate from unrelated application changes when the dependency graph permits it. If Alchemy requires an Effect upgrade, verify the exact peer dependency first. Read the repo-local `effect` skill before changing Effect code. Explain any required package patches and define how the project can remove them.

For a v1-to-v2 migration, require evidence for these items before merge:

- a clean frozen install
- typecheck and deployment configuration verification
- an explicit preview stage plan
- a successful preview deploy and teardown
- a reviewed, one-time production adoption plan

