# Pull request contract

Garden uses a pull request contract to check the minimum information needed
before a pull request can merge. The check lives in
`scripts/verify-pr-contract.mjs` and runs in the `PR contract` GitHub Actions
job.

## Use the correct target branch

Use `dev` for normal work. Use `main` only for a release pull request whose
source branch is `dev`.

The check rejects other target branches. The branch rule in GitHub must also
allow only maintainers to merge into `dev` and keep maintainer approval
required for `main`.

The workflow also runs on pushes to `dev` and `main`. A push does not contain a
pull request body, so the job records a passing not-applicable status. This
makes `PR contract` available in GitHub's branch-rule check list. Pull request
events still run the full contract.

## Write the required pull request sections

A non-draft pull request must include these sections:

- What changed
- Why
- Scope
- Contribution standard
- Documentation
- Checks
- Verification
- Risk and follow-up

The contribution section must confirm that the author stated the outcome and
non-goals, read the relevant documentation and code, and reviewed the final
diff.

The documentation section must name the documents that changed. If no document
needs an update, it must state why. A behavior change without documentation or
that reason fails the check.

The checks section must list commands. The verification section must state
`PASS`, `FAIL`, or `INCONCLUSIVE` and identify the evidence.

Draft pull requests only need a valid target branch and a useful title. The
full body check runs when the pull request is ready for review.

## Run the check locally

GitHub provides the event file through `GITHUB_EVENT_PATH`. To run the check
with a saved event file, use:

```bash
pnpm verify:pr --event path/to/pull-request-event.json
```

The workflow checks the changed paths with the base and head commit from the
event. It needs the full Git history, so the workflow uses `fetch-depth: 0`.

## Understand the proof boundary

The contract check proves facts that GitHub can inspect:

- the target branch is allowed;
- the title and required sections exist;
- required checklist items are checked;
- commands and verification evidence are named;
- behavior changes include documentation or a documented reason.

It cannot prove that a person read a document or that a claimed evidence path
is truthful. The normal CI checks prove formatting, lint, type safety, tests,
build output, and deployment configuration. A maintainer must still review the
design, evidence, and user-flow result.
