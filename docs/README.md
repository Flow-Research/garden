# Garden documentation

Read this page before changing Garden. Documentation is part of feature work.
It records the agreed behavior, boundaries, and design rules that an agent must
know before it edits code.

Code and tests define the behavior that exists today. Plans and design
documents define intended behavior. If they disagree, check the code and tests,
then update the document that is now wrong.

## Read in this order

1. Read the repository rules in `AGENTS.md` and the contribution skill at
   `../.agents/skills/contribute/SKILL.md`.
2. Read the relevant feature document in [`features/`](./features/README.md).
   Create one from the template when a new feature has no document.
3. Read the relevant architecture document in [`core/`](./core/technical.md).
4. Read the relevant design rules in [`design.md`](./design.md) and
   [`vibe.md`](./vibe.md) for UI work.
5. Read the matching roadmap and known-gap documents before changing scope or
   release behavior.
6. Read the verification map at
   `../.agents/skills/verify/features/README.md` before changing a user flow.

Do not read every document by default. Use the map below to choose the smallest
set that answers the work question.

## Choose the right document

| Question | Read |
| --- | --- |
| What is Garden building now? | [`roadmap.md`](./roadmap.md), [`core/PRD.md`](./core/PRD.md) |
| Where does this behavior live? | [`core/technical.md`](./core/technical.md) |
| What is the agent contract? | [`core/system-spec.md`](./core/system-spec.md) |
| How do runtime, tools, and permissions work? | [`core/workflows-engine.md`](./core/workflows-engine.md), [`core/connectors.md`](./core/connectors.md), [`core/project-think-cloudflare.md`](./core/project-think-cloudflare.md) |
| What UI rules apply? | [`design.md`](./design.md), [`vibe.md`](./vibe.md) |
| What feature or design decision exists? | [`features/`](./features/README.md) |
| What must not be claimed yet? | [`known-gaps/`](./known-gaps/README.md) |
| How do I prove the change? | [`../.agents/skills/verify/SKILL.md`](../.agents/skills/verify/SKILL.md) |

## Documentation is part of done

For a new feature, add or update a document under `docs/features/` in the same
pull request as the implementation. The document is the design contract for
the feature. It must state the outcome, scope, user behavior, system boundary,
permissions, important failure states, and verification path.

For a bug fix or refactor, update the nearest document when the change affects
behavior, a design rule, an ownership boundary, or an operational procedure.
If the change does not affect any of those, record that reason in the pull
request.

For an architecture or infrastructure change, record the decision and its
trade-offs in the relevant `docs/core/` or `docs/features/` document before
implementation.

Use the [feature documentation guide](./features/README.md) for the required
sections and the [feature template](./features/_template.md) for new documents.
