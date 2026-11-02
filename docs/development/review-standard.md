# Garden review standard

Use this standard for pull request reviews and contributor-facing review
comments. The goal is simple: show what works, explain what remains, and give
the contributor one clear next action.

## Review structure

Start with a specific thank-you:

```text
Thank you @username for the work on [change].
```

Then use this order:

1. **What passed**: name the behavior, checks, or evidence that works.
2. **Before merge**: list blocking findings.
3. **Follow-up**: list non-blocking improvements separately.
4. **Review status**: state `APPROVE`, `REQUEST_CHANGES`, or `COMMENT`.
5. **Next action**: tell the contributor what to do next.

Do not use a general compliment as a substitute for evidence. Do not call a
follow-up a blocker. Keep each finding specific enough that a contributor or an
agent can act on it without guessing.

## Finding format

Use this format for each blocking or non-blocking finding:

```text
Finding: [specific problem]
Impact: [what can break or become difficult]
Evidence: [file, line, test, command, log, or reproduction]
Request: [exact change or check needed]
```

Use file paths, test names, command names, and links when they reduce doubt.
Use a short reproduction when the problem is easier to demonstrate than to
describe.

## Review template

```text
Thank you @username for the work on [change].

I verified [behavior or checks]. These checks passed:
- [check]
- [check]

Before merge, please address:

1. Finding: [specific problem]
   Impact: [what can break]
   Evidence: [file, test, command, log, or reproduction]
   Request: [exact change or check needed]

Follow-up:
- [non-blocking improvement]

Review status: REQUEST_CHANGES

Please update [specific area], then rerun [specific check].
```

For an approval, replace the blocking section with a clear statement that no
blocking issues remain:

```text
Review status: APPROVE

The stated behavior works. I found no remaining blocking issues.
```

## Human and agent readability

Human readers need a respectful tone, a clear reason, and no blame. Agents
need stable labels and explicit outcomes. The labels `Finding`, `Impact`,
`Evidence`, `Request`, `Follow-up`, and `Review status` provide that structure
without forcing review comments into JSON or another rigid format.

The review status must match the body. If a blocking finding remains, use
`REQUEST_CHANGES`. If the change is safe to merge, use `APPROVE`. Use `COMMENT`
when the review gives context or asks a question without blocking the change.

## What checks should enforce

CI should enforce evidence and contribution requirements, such as:

- the pull request explains the change and its purpose;
- behavior changes name their checks or tests;
- documentation changes are included or explicitly ruled out; and
- the final diff and wider effects were reviewed.

CI should not try to measure warmth or enforce exact reviewer wording. Keep
`Thank you @username` as a shared maintainer convention.

## Maintainer rollout

Use this format for the next three reviews. Note which comments still cause
confusion. Update this document after that trial. Add automation only for
missing evidence, missing status, or missing checks.
