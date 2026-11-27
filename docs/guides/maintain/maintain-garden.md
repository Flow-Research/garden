---
title: Maintain the Garden queue
description: Triage, review, verify, and release Garden pull requests as a maintainer.
status: current
owner: "@Umoren"
last_reviewed: 2026-11-03
---

Use these steps to move issues and pull requests from triage to release.

## Use the contribution standard

Every Garden change follows
[`.agents/skills/contribute/SKILL.md`](../../../.agents/skills/contribute/SKILL.md).
The standard follows the pstack work sequence:

1. Scope the outcome and non-goals.
2. Understand the current code and boundary.
3. Design the smallest verifiable unit.
4. Implement a focused change.
5. Prove the behavior.
6. Review the diff and its wider effects.
7. Hand off a complete pull request.

Pstack is the default workflow for agents that have it. The required outputs
also apply to human contributors and agents without pstack. Do not require a
tool that a contributor cannot access. Require the same evidence and review
standard instead.

## Keep the queue clear

Start with the current `dev` branch. Check every pull request in this order:

1. Confirm that the pull request targets `dev`.
2. Check whether the change is still needed on current `dev`.
3. Read the changed files and the linked issue.
4. Check conflicts and status checks.
5. Classify the pull request as `merge now`, `needs changes`, `blocked`, or
   `superseded`. [Review format](../../reference/review-format.mdx) defines each status.

Close a superseded pull request with a comment that links to the implementation
that replaces it. Do not ask an author to rebase a change that the current code
already contains.

## Review one pull request

Use this order for a pull request that is still needed:

1. Read the title, issue, and changed-file list.
2. Read the relevant feature and architecture documents.
3. Check the behavior at the changed boundary. Check permissions, migrations,
   external calls, and error handling when they are in scope.
4. Check that the documentation matches the implementation and the proof path.
5. Run the smallest package checks first.
6. Run the real user flow for UI, connector, agent, workflow, or deployment
   changes.
7. Record the result in the pull request in the [review format](../../reference/review-format.mdx). Then merge, request a change, or defer the pull request.

Use `pnpm run doctor` before a local verification run. The command is read-only. It
checks Node.js, pnpm, Docker, the required local services, and the Garden app.

## Run repository checks

CI runs once for a pull request that targets `dev` or `main`. It also runs on
direct pushes to `dev` and `main`. It does not run on every push to a feature
branch because the pull request run already checks that branch.

Run the checks that match the changed files. Run the full set before a broad
merge or release:

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm verify:docs
pnpm verify:deploy-config
```

For connector changes, also run:

```bash
pnpm verify:connectors
pnpm --filter @garden/connectors typecheck
pnpm --filter @garden/connectors test
```

## Verify the product

The verification skill lives at `.agents/skills/verify/SKILL.md`. It describes
the local stack, the health check, user-facing feature paths, evidence, and
cleanup.

To start the local stack, choose the Docker or native Ollama setup in
[Run Garden locally](../../tutorials/get-started.md), then run:

```bash
pnpm offline:up
pnpm --filter @garden/db db:migrate
pnpm dev:offline
```

Then run:

```bash
pnpm run doctor
```

The first verification map covers the beta path from the roadmap and the
Decide connector path from [issue #211](https://github.com/Flow-Research/garden/issues/211).
The current map documents the steps before browser drivers are added. A manual
check without saved evidence is `INCONCLUSIVE`.

## Merge and release

Merge accepted work into `dev`. Check the `dev` deployment after changes that
touch runtime behavior. Open a separate pull request from `dev` to `main` when
the release set is ready.

Do not deploy from a feature branch. To deploy preview, dev, or staging, see
[Deploy Garden](../operate/deploy.md) and `.agents/skills/deploy/SKILL.md`.

## Work with agents

Use separate agent passes for separate jobs:

- A triage pass reads pull requests and suggests a classification.
- A review pass reads the diff and checks the evidence.
- A fix pass edits only the assigned branch.
- A verification pass drives the real product path.

The final merge decision remains with a maintainer. An agent report, a green
typecheck, or a passing unit test does not prove a user flow by itself.

## Record workflow lessons

When a repeated mistake costs time, update the smallest durable place that can
prevent it:

- Add a repository rule to `AGENTS.md` when the rule applies to Garden code.
- Add a verification step or feature note under `.agents/skills/verify/` when
  the rule proves product behavior.
- Add a maintainer step here when the rule changes the queue or review process.
- Add or close a row in [Known gaps](../../reference/known-gaps.md) when a gap opens or closes.

Keep product changes and workflow changes in separate pull requests.
