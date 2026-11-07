---
title: Submit a Garden contribution through Workstream
description: Claim a Garden task, submit real current-head GitHub proof, and inspect the governed result.
status: current
owner: '@Abiorh001'
last_reviewed: 2026-11-07
---

Use this handoff when a Project Manager assigns Garden work through Workstream.
Follow the ordinary [contribution standard](../../../CONTRIBUTING.md) and
[Garden change workflow](ship-a-change.mdx) alongside the task's locked guide.
Garden contributors can continue using ordinary GitHub pull requests without
Workstream assignments.

Workstream owns the task, assignment, immutable Submission and governed outcome.
GitHub supplies independently retrieved code, check and configured review facts.
An agent can help with the work; the assigned contributor remains accountable.
A Workstream login does not establish a GitHub identity mapping.

## Claim the task and read its rules

Obtain the Workstream API address, external account login instructions and an
operator-approved [Workstream CLI build](https://github.com/Flow-Research/workstream/tree/main/cli).
Supply its bearer privately through `WORKSTREAM_TOKEN` and its API origin through
`WORKSTREAM_API_URL`. Keep credentials out of commands, commits and proof files.

Use the actual task UUID and a caller-owned UUID saved with the exact command.
Create an empty local `GUIDE_DIRECTORY` for verified original-document downloads:

```sh
workstream task ready PROJECT_ID --output json
workstream task claim TASK_ID --idempotency-key CLAIM_UUID --output json
workstream task context TASK_ID --output json
workstream task requirements TASK_ID --output json
workstream task guide TASK_ID --download GUIDE_DIRECTORY
```

Claim immediately starts work: the receipt must identify the task as
`in_progress` with your active assignment. There is no separate start command.
Save the returned assignment UUID. Read the assigned guide, requirements and
locked policy identities before editing; an active project guide does not
replace an earlier assignment's locked rules.

## Complete the change on its actual PR head

Start from current `dev`, keep the change within the task and target `dev`.
Run the applicable repository checks, including `pnpm verify:docs` for
documentation. Before final GitHub checks and any required review, put exactly
one task trailer in the final block of the PR head commit message:

```text
Workstream-Task: <actual lowercase Workstream task UUID>
```

Separate that block from the commit message body with a blank line. Put no other
occurrence of the reserved marker in that commit message. A marker in the PR
body or uploaded JSON does not bind the head to the task. A changed head,
including a changed commit message, needs fresh current-head CI and any required
review. Submit work you actually completed; do not relabel an older contribution.

The Garden v3 drill explicitly selects `required_independent_approvals=0`.
Omitting that setting requires one eligible independent current-head GitHub
approval; positive counts retain their configured requirement. Required trusted
CI must pass even when the approval count is zero. The PR can remain open:
current-head Garden proof does not require a GitHub merge.

## Package the actual proof

After the final required checks pass, write one UTF-8 `proof.json` using the
actual PR, current head SHA and successful required Actions run. Replace every
placeholder in this example; it is not usable evidence unchanged:

```json
{
  "schema": "garden.work.proof.v1",
  "pr_url": "https://github.com/Flow-Research/garden/pull/PR_NUMBER",
  "commit_sha": "FULL_CURRENT_HEAD_SHA",
  "ci_run_url": "https://github.com/Flow-Research/garden/actions/runs/RUN_ID",
  "ci_conclusion": "success"
}
```

Use exactly those five fields. The task UUID comes from Workstream and the
verified head trailer, not an added JSON claim. Package only the root file:

```sh
python3 -m zipfile -c work-proof.zip proof.json
python3 -m zipfile -l work-proof.zip
```

The v3 guide allows one regular root `proof.json`, at most 64 KiB expanded and
128 KiB for the complete archive. Check your assignment's actual requirements.
Do not include source checkouts, credentials, screenshots or invented test logs.
Keep the exact archive bytes for replay.

## Prepare, then create the Submission

Use the actual assignment UUID from the claim receipt and a new saved preparation
UUID. Keep summary and attestation truthful and unchanged across exact replay:

```sh
workstream task prepare TASK_ID --assignment ASSIGNMENT_ID --file work-proof.zip \
  --idempotency-key PREPARATION_UUID --summary 'Completed assigned documentation' \
  --attestation 'I submit this exact archive for Workstream checks.' --output json
```

PRE checks the archive and bounded proof structure before Submission creation.
A failure blocks admission and provides actionable findings. Correct the reported
problem; do not treat a successful upload or valid JSON as verified GitHub work.
For retained preparation feedback, inspect:

```sh
workstream task preparations TASK_ID --output json
workstream task preparation TASK_ID PREPARATION_ID --output json
```

If verification is pending, wait and explicitly repeat the same preparation
command, UUID, archive bytes and packet. Never substitute a fresh key because a
response was lost. Only a `ready` receipt with an actual admission UUID permits:

```sh
workstream task submit TASK_ID --assignment ASSIGNMENT_ID --admission ADMISSION_ID \
  --summary 'Completed assigned documentation' \
  --attestation 'I submit this exact archive for Workstream checks.' --output json
```

Submission creation replays through that exact admission and packet; it has no
additional caller-generated creation key. Preserve the returned Submission and
evaluation request UUIDs. For revisions, inspect current task context and follow
the CLI's explicit predecessor/preparation requirements before uploading again.

## Inspect POST and the governed outcome

POST evaluates the immutable Submission using independently retrieved GitHub
facts. A claimed successful CI result alone cannot make POST pass. Read the
actual Submission and durable findings:

```sh
workstream submission show SUBMISSION_ID --output json
workstream submission findings SUBMISSION_ID --output json
workstream contributions --project PROJECT_ID --output json
```

Quality failures and infrastructure failures need different recovery. Preserve the
exact inputs and findings; an unavailable checker is not verified poor work or
acceptance. Ask the Project Manager about routing or revision requirements.

The approved Garden v3 drill separately locks
`human_review_required=false`: passing required POST invokes Workstream's shared
authorized final acceptance operation. It creates no Review or reviewer
contribution. Other tasks can require human review by default; the GitHub
approval count does not change that Workstream policy.

Confirm the actual accepted Submission and submitter ContributionRecord reference
your task, assignment, exact artifact and locked contribution policy. Inspect any
applicable award separately: earned project points are not payment or fulfillment.
Exact Submission replay must preserve the Submission/evaluation identities and
must not duplicate contribution records or awards. An uncertain response is not
proof of rollback; inspect current state before explicit unchanged replay.

Workstream's MCP clients use the same lifecycle through caller-authenticated
`workstream_*` tools: claim, context/requirements, preparation, Submission,
findings and contribution reads. Pass the bearer only in transport headers.
Retained PRE feedback is available through `workstream_preparations_list` and
`workstream_preparation_get`. Use the operator's supported endpoint and client;
this handoff does not install a Garden connector or link account identities.
