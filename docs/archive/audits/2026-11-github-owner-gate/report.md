---
title: "GitHub owner gate verification (November 2026)"
description: Snapshot of the evidence run for #332 — validating GitHub tool-call owners against the connected installation account.
status: archived
owner: "@Umoren"
last_reviewed: 2026-11-11
---

> **Historical snapshot.** This page records the verification evidence at the time it was written. It is not current truth.

Timestamp: 20261111T070755Z (UTC)
Branch: fix/github-repo-identity
Profile: lite (one scenario per changed behavior)

## Scope

Repo-scoped GitHub tool calls must validate `owner` against the connected
installation account login before any GitHub request, on both the native and
hosted surfaces, and repository 404s must carry a retry hint.

## Driver

`pnpm --filter @garden/agent-runtime exec vitest run \
  src/runtime-mcp-controller.github-owner.integration.test.ts`

The test runs the production path: real `wrapGetAITools` assembly → owner gate →
real RSA JWT signing → token mint → REST client → response decode. Only the
GitHub HTTP boundary is stubbed.

## Scenarios

| Action | Expected | Observed | Result |
| --- | --- | --- | --- |
| Native `list_branches` with owner `flowresearch` (the #332 input) | Rejected naming `Flow-Research`; no token mint, no GitHub call | `{error:true, message contains Flow-Research}`; zero HTTP calls | PASS |
| Native `list_branches` with owner `flow-research` | Owner corrected; request path uses `Flow-Research` | Calls: `POST /app/installations/51337001/access_tokens`, `GET /repos/Flow-Research/garden/branches`; result = branch list; repo call authenticated with minted token | PASS |
| Native `list_branches` with owner `" Flow-Research "` | Trimmed before request | GET came after the branch path with canonical owner | PASS |
| Native `list_branches` with wrong repo `garden-cli` | GitHub 404 mapped to not-found with retry hint | `{error:true, message contains list_repositories}`; GET `/repos/Flow-Research/garden-cli/branches` | PASS |
| Hosted `list_issues` with owner `flowresearch` | Rejected before hosted MCP dispatch | `{error:true}`; hosted callTool not called; zero HTTP calls | PASS |

## Supporting suites

- `pnpm --filter @garden/agent-runtime test`: 45 files / 255 tests pass (Docker-backed controller suites included)
- `pnpm --filter @garden/connectors test`: 11 files / 72 tests pass
- Typecheck: @garden/connectors, @garden/agent-runtime, @garden/web, repo-wide turbo 12/12
- Lint: connectors, agent-runtime, web — 0 errors
- `pnpm verify:docs`: 57 pages OK

## Limits

No live GitHub App install or model-driven chat turn was driven (local env has
no GITHUB_APP credentials), so the browser user path is not exercised here; the
gate, JWT mint, REST call, and error classification are exercised end to end
against a stubbed GitHub API.

## Real-network run (gh CLI credential)

Driver: one-shot vitest file (deleted after the run, not committed) that mocks
only `createGitHubInstallationAccessToken` to return `gh auth token` and leaves
the gate, Effect layers, REST client, and `api.github.com` real.

| Action | Observed | Result |
| --- | --- | --- |
| `list_branches` owner `Flow-Research` | real API returned 30 branches; `GET /repos/Flow-Research/garden/branches` | PASS |
| owner `flowresearch` | rejected naming `Flow-Research`; zero HTTP requests | PASS |
| owner `flow-research` | corrected; real `GET /repos/Flow-Research/garden/branches` | PASS |
| owner `Flow-Research`, repo `garden-no-such-repo-xyz` | real 404 body + `list_repositories` hint | PASS |

Credential note: real App installation tokens need a GitHub App install; the
run substituted a PAT at the mint boundary, which does not change the gate or
the REST request path. Hosted `github-mcp.*` surface remains covered by the
stubbed test only (needs an installation token).

## Live user-flow run (real app, real GitHub App, real model)

Setup: local stack (`dev:offline`, Postgres + Helix via compose, native LM
Studio on `:1234`), model `lfm3-1.7b-uncensored`. GitHub App created by
manifest flow (`garden-local-mwbwj9wn`, id 5710016), installed on personal
account `getoyami` with a disposable fixture repo `getoyami/garden-e2e`.
Signed up a fresh Garden account/workspace in the browser, connected GitHub via
Connections, then drove chat. Tool surface exercised live: Garden-hosted
`github-mcp.*` (branches + rejection) and native `github.*` (404 hint).

| Action (chat message) | Observed in app | Result |
| --- | --- | --- |
| Call `github.list_branches` with owner `getoyami`, repo `garden-e2e` | "Completed in 1 step"; branch `main` sha `8037e72…` returned | PASS |
| Call with owner `flowresearch` (the #332 input) | Tool refused: `GitHub owner "flowresearch" is not the connected GitHub account "getoyami"…` (agent then retried with `getoyami` and succeeded) | PASS |
| Call with owner `getoyami`, repo `garden-e2e-missing` | `github.list_branches failed: {"message":"Not Found"…404} The owner or repository name may be wrong or wrongly cased — call list_repositories…` | PASS |

Screenshots: `screenshots/07-connectors.png`, `08-github-install-page.png`,
`09-install-selected.png`, `10-after-install.png`, `11-chats.png`,
`13-lfm-correct-owner.png`, `13-lfm-wrong-owner.png`,
`13-lfm-rejection.png`, `13-lfm-404-hint.png`, `15-thread.png`,
`16-correct-owner-result.png`.

Browser note: headed Chromium repeatedly closed mid-run under memory pressure
with LM Studio loaded; Garden stays worked headless for all reads/sends after
the one-time GitHub login.

Cleanup: fixture repo and the local GitHub App remain; see PR follow-up.
