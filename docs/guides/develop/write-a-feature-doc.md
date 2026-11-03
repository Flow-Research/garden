# Feature documentation

Feature documents describe what Garden should do, why it does it, and how a
maintainer can prove it. Read the matching document before changing a feature.

## Start a feature

1. Find the existing document in this directory.
2. If no document exists, copy [`_template.md`](./_template.md) to a name that
   describes the feature.
3. Set the status to `proposed` while the design is under discussion.
4. Update the same document when the implementation changes the design.
5. Set the status to `current` only when the code and verification path match
   the document.

Keep feature documents focused. Link to architecture references instead of
copying their full content.

## Required sections

Every feature document must define:

- the user or maintainer outcome;
- the scope and non-goals;
- the visible behavior and important states;
- the system boundary, data, permissions, and external calls;
- the decisions that future contributors must not break;
- the verification path and its evidence;
- open gaps, risks, and follow-up work.

Use a smaller document for a small feature. Do not create a large design paper
for a one-line bug fix.

## Document status

- `proposed`: the design is agreed enough to implement, but the feature is not
  current code.
- `current`: the document matches the shipped behavior and its proof path.
- `known-gap`: the behavior or proof is incomplete and the limitation is
  intentional.
- `superseded`: another document or implementation replaces this design.
