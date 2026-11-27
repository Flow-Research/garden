---
title: Write a feature doc
description: Create or update the feature document that describes what a Garden feature does and how to prove it.
status: current
owner: "@Umoren"
last_reviewed: 2026-11-03
---

Feature documents live in `docs/concepts/features/`. Each one explains what a feature does, why, and how a maintainer proves it. Read the matching document before you change a feature.

## Create a feature doc

1. Look for an existing document in `docs/concepts/features/`. If one exists, update it instead.
2. Copy the template:

   ```bash
   cp docs/templates/feature.md docs/concepts/features/feature-name.md
   ```

3. Fill in the frontmatter. Set `status` to `proposal` while the design is under discussion.
4. Fill in each section. Delete a section only if it does not apply, such as **Data and permissions** for a feature with no writes.
5. Add the file name, without `.md`, to `pages` in `docs/concepts/features/meta.json` so that it appears in the handbook sidebar.
6. Commit the document in the same pull request as the code.

For a small feature, write a short document. A one-line bug fix needs no feature document.

## Keep the doc current

When the implementation changes the design, update the document in the same pull request. Update `last_reviewed` to the date you checked the document against the code.

Link to architecture pages in `docs/concepts/architecture/` instead of copying them.

## Set the status

The `status` frontmatter field takes one of four values:

| `status`   | Use when                                                                    |
| ---------- | --------------------------------------------------------------------------- |
| `proposal` | The design is agreed enough to build, but the feature is not in the code.   |
| `current`  | The document matches the shipped behavior and its proof path.               |
| `decision` | The page records a dated decision. Feature docs rarely use it.             |
| `archived` | Another document or implementation replaces this one. Move it to `docs/archive/`. |

Do not put status lines in the body. Record a known limitation under **Gaps and follow-up** and add a row to [Known gaps](../../reference/known-gaps.md).

## Check the doc before you open the pull request

Run:

```bash
pnpm verify:docs
```

The `PR contract` check also requires the Documentation section of your pull request to name the doc you changed. See [Pull request contract](../../reference/pr-contract.mdx).
