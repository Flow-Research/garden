---
name: contribute
description: Work on Garden changes with the repository's pstack-based contribution standard. Use for features, bugs, refactors, documentation, and infrastructure changes.
---

# Contribute to Garden

Use this skill before changing Garden. It defines the work sequence that all
contributors should follow.

Pstack is the default agent workflow when it is available. The required
outputs also work for human contributors and agents that do not have pstack.
The standard is the evidence and review process, not a required runtime
dependency.

## Work sequence

1. Scope the change.
   - Start from `dev`.
   - State the outcome, changed boundary, and non-goals.
   - Read `docs/README.md` and choose the relevant design documents.
   - Keep one user or maintainer outcome in one pull request.
2. Understand the current system.
   - Read the issue, relevant code, tests, feature document, and architecture
     document.
   - Find the existing owner and boundary before adding a new abstraction.
3. Design the smallest verifiable unit.
   - Name the behavior that must change.
   - Name permissions, data writes, external calls, and failure states in scope.
   - Add or update a feature document before implementing a new feature.
   - Record decisions for work that spans multiple sessions or contributors.
4. Implement a focused change.
   - Follow existing patterns.
   - Keep unrelated cleanup in a separate pull request.
   - Use one commit for each independently verifiable unit.
5. Prove the behavior.
   - Run the smallest checks that cover the changed files.
   - Use `.agents/skills/verify/SKILL.md` for UI, connector, agent, workflow,
     and deployment behavior.
   - Update the verification map when the feature adds a new user path.
   - Report `PASS`, `FAIL`, or `INCONCLUSIVE` for user-flow proof.
6. Review the change before handoff.
   - Read the final diff as a reviewer.
   - Remove generated or unrelated code.
   - Check the change's effect on callers, permissions, migrations, and
     deployment targets.
7. Handoff a complete pull request.
   - Target `dev`.
   - State what changed, why, checks run, evidence, risk, and follow-up.
   - Link the issue and name any proof that is still missing.
8. Leave the merge decision with a maintainer.
   - An agent can inspect, implement, and recommend.
   - A maintainer decides whether the change is safe to merge.

## Pstack mapping

When pstack is available, use these skills for the matching work:

- `pstack:how` before changing an unfamiliar area.
- `pstack:architect` for cross-cutting or structural changes.
- `pstack:principle-sequence-verifiable-units` for multi-step work.
- `pstack:make-pr-easy-to-review` before opening a pull request.
- `pstack:deslop` and `pstack:blast-radius` before handoff.
- `pstack:principle-prove-it-works` before declaring the change complete.
- `pstack:show-me-your-work` for long-running or unattended work.
- `pstack:technical-writing` when writing or reviewing feature and design
  documents.

If pstack is not available, follow the work sequence and produce the same
pull-request fields and evidence.

## Minimum handoff

Every pull request must contain:

- one outcome and its non-goals;
- the issue or reason for the change;
- checks run and their results;
- user-flow evidence when the change affects user behavior;
- the matching feature or design document when the change adds or changes
  behavior;
- known risk, missing proof, and follow-up work.

Do not call a passing typecheck proof of a user flow.
