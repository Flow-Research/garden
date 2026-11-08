---
title: Feature name in sentence case
description: One sentence. What the reader learns about this feature.
status: proposal        # proposal | current | decision | archived
owner: "@Umoren"
last_reviewed: YYYY-MM-DD
---

Copy this file to `docs/concepts/features/feature-name.md`. Delete this paragraph and every placeholder line. See `docs/guides/develop/write-a-feature-doc.md`.

Related issue: [#000](https://github.com/Flow-Research/garden/issues/000)

## What the feature does

State what a user or maintainer can do once this feature exists. One short paragraph.

## Why it works this way

Explain the design decisions that future changes must keep, and the reason for each. Name the alternatives you rejected. Link the source or discussion when one exists.

## Scope

In scope:

-

Out of scope:

-

## What the user sees

1. The first action.
2. The visible result.
3. The success, waiting, refusal, and failure states.

## Where it lives

Name the routes, packages, Durable Objects, Workflows, tables, connectors, and external services that own this behavior. Use real paths and symbols, such as `packages/server/src/issues/run-service.ts` and `startIssueRun`. Link to the architecture page in `docs/concepts/architecture/` instead of copying it.

## Data and permissions

State the data that the feature reads and writes. State the workspace and user permissions that control each write or external action.

## How to verify it

List the checks and the real user flow that prove the feature. Link to the matching file in `.agents/skills/verify/features/`.

## Gaps and follow-up

List missing proof, known risks, rollout limits, and follow-up work. Add each open gap to `docs/reference/known-gaps.md`.
