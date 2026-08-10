# Open-source provenance audit

**Snapshot:** 2026-08-08. This is engineering release evidence, not legal
advice.

## Release state

Garden is licensed `AGPL-3.0-only`. The public branch preserves the project's
curated commit graph while removing private worktrees, runtime state, local
logs, obsolete source mirrors, unlicensed skill bundles, and superseded
implementations from every reachable commit.

The release tree contains no Harnessy runtime or package bundle. Harnessy is a
separate first-party project; Garden's `/harnessy` page is product direction,
not shipped connector source.

## Shipped source-derived components

| Component | License | Garden use |
| --- | --- | --- |
| Executor v1.5.40 | MIT | Public SDK runs in Garden's Worker. A small exact-source closure is retained only where upstream packages or preset exports are unpublished. Garden changes are listed in `third_party/executor/PATCHES.md`. |
| Cloudflare OS Workspace Docs | Apache-2.0 | Exact client and server sources provide the canonical document editor and mutation semantics. Garden supplies authenticated Effect HttpApi, Durable Object storage, and SSE adapters. |
| Cloudflare Agents | MIT plus upstream notices | Garden carries an attributed package patch and the matching license, NOTICE, and third-party inventory. |
| Bundled agent skills | Upstream-specific permissive licenses | Every retained skill bundle is mapped to source and license in `third_party/agent-skills/UPSTREAM.md`. |
| shadcn/ui | MIT | Standard UI primitives retain the upstream notice. |

The exact upstream commits, source paths, hashes, and local modifications are
recorded beside retained source and in `THIRD_PARTY_NOTICES.md`.

## Document architecture

DOCX uploads remain immutable source objects. Cloudflare Workers AI converts
DOCX to Markdown, which Garden sanitizes into canonical versioned HTML blocks.
The exact Cloudflare Workspace Docs client edits those blocks through the same
authenticated authority used by agents.

The canonical document authority is a per-thread Durable Object facet with:

- serialized mutations;
- per-block optimistic versions;
- operation-id deduplication;
- compact accepted-operation broadcasts; and
- authoritative conflict results.

DOCX and PDF output are projections from canonical state. Uploaded OOXML is not
mutated in place.

## Connector architecture

Executor is constructed in-process from `@executor-js/sdk/core`. Garden API
routes, OAuth, connection mutation, tool execution, and MCP Durable Objects run
inside the Garden Worker against one Effect runtime. There is no separate
connector Worker, MCP proxy, renamed Executor fork, or vendored Harnessy
package.

## Release gates

- Root and workspace manifests use `AGPL-3.0-only`.
- Third-party source carries its upstream license and provenance from first
  introduction.
- Full rewritten history passes scoped Gitleaks rules with zero findings.
- The final tree passes install, lint, typecheck, tests, and production build.
- The reviewed document-editor before/after images remain cropped to the
  product surface with no workspace identity metadata. The README also carries
  maintainer-supplied issue-board, Agents, and Connections catalog screenshots.
  The Agents and Connections images contain no credentials, email addresses,
  URLs, or message bodies. The issue-board image intentionally retains visible
  issue details and contributor names after the maintainer approved
  publication.
- The public branch contains the curated full commit graph, not a squashed or
  parentless export.

## Verification

- Direct runtime import and route search for Executor, document, and MCP paths.
- Exact-source hash and license comparison for retained third-party files.
- Workers-runtime MCP execution, resume, output-bound, and Durable Object
  hibernation tests.
- Canonical document conflict, idempotency, sanitization, HttpApi, and live
  persistence tests.
- Authenticated before/after document editor capture with save and hard-reload
  persistence verification.
- Full-history forbidden-path, identity, object, and secret scans.
