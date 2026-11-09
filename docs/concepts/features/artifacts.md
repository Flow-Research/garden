---
title: Garden has three kinds of artifact and no unified model yet
description: How document artifacts, issue work products, and sandbox previews differ, how live document editing reaches parity with Cloudflare Workspace Docs, and where each kind stops.
status: current
owner: "@Umoren"
last_reviewed: 2026-11-03
---

Agents produce three kinds of output that people review: document artifacts, issue work products, and sandbox files with previews. Each has its own storage and its own limits. They are not one artifact system.

## Document artifacts are durable and versioned

A document artifact is a file, such as a DOCX or PDF, that a chat agent generates or a user uploads. It is the only artifact kind with durable storage and versions.

- Postgres stores metadata in `document` and `document_version` (`packages/db/src/schema/documents.ts`).
- The R2 `FILES` bucket stores the bytes.
- Routes under `/api/documents/:id/` serve display, DOCX, metadata, versions, and the live artifact.
- `GardenArtifact` and `DocumentArtifact` in `apps/web/src/features/artifacts` render them.
- Chat agents use the `listDocuments`, `readDocument`, `findInDocument`, `generateDocx`, and `editDocument` tools from `packages/agent-runtime/src/documents/document-tools.ts`.

Document artifacts are owned by one chat thread. `workspace_id` controls access but does not make a document a shared workspace file. The data model is specific to documents, so it does not fit generated web apps, images, or code bundles.

## Live document editing matches Cloudflare Workspace Docs

The canonical content of a document artifact is a snapshot of ordered HTML blocks with versions. Garden adapted it from the Workspace Docs gadget bundled in Cloudflare OS. The exact upstream `client.js` and `server.js` are kept in `third_party/cloudflare-os/workspace-docs/`, with their source and SHA-256 recorded in `UPSTREAM.md`. `server-authority.ts` in that folder is a typed adaptation of the upstream mutation logic.

Garden runs that logic inside the chat facet that owns the document, not in a gadget Durable Object. The pieces fit together like this:

- The facet stores each document's snapshot under the key `document:v2:<documentId>`. The suffix is needed because one facet owns several documents. Applied operation IDs are stored alongside it.
- `SynchronizedRef` in `document-artifact-repository.ts` serializes each read, transition, and write.
- A batch commits valid blocks and returns stale blocks as conflicts. Each upsert or delete checks the block's `baseVersion`. Ordering is last-writer-wins.
- Retries are idempotent. A repeated `operationId` returns the earlier outcome. The upstream gadget has no such guarantee.
- Accepted operations publish as `DocumentArtifactEvent` values on an Effect PubSub in the facet. They travel over a Workers RPC stream to the web Worker, then to the browser as server-sent events. Pure conflicts do not publish.
- The subscription opens before the snapshot is read, so a racing write is buffered, not lost. A reconnect starts with a full snapshot. A gap in revisions makes the client reload the snapshot over HTTP.
- The editor keeps the caret and unsaved text in place. Live updates advance the base version while keeping local edits, so the next save rebases on the latest block.

Presence, meaning other people's carets and selections, is not built. It needs a product identity and caret UI and a separate ephemeral channel.

### Garden uses neither Yjs nor Cap'n Web here

Cloudflare OS uses Yjs for source-code editing and its `.gadget` archive format. The Workspace Docs runtime itself does not use Yjs. Its content is a JSON snapshot, and like Garden it does not support two people editing the same paragraph at once. A CRDT would not create parity.

Cap'n Web gives a sandboxed gadget a browser-to-server transport with callbacks. Garden is not a sandboxed gadget client. It reaches the same behavior through boundaries it already has: typed Effect HttpApi commands, authorization in the web Worker, native Workers RPC to the owning facet, PubSub in that facet, and server-sent events back to the browser. Workers RPC already carries backpressured `ReadableStream` values, and `EventSource` owns reconnect.

Effect Machine was also evaluated and not adopted. Document paths have no asynchronous export job or persisted lifecycle for a state machine to enforce.

## Issue work products are reviewable deliverables

An issue work product is the output of an issue run, such as a report, checklist, plan, or proposed change. It lives in the `issue_work_product` table with a type, title, body, payload, status, and review state. The issue-run tools `create_work_product` and `revise_work_product` write it, and the Inbox and issue review flows surface it.

Work products fit text and JSON that people review and revise. They have no R2 backing, no file versions, and no preview URL, and the artifact renderer does not draw them.

## Sandbox output is a fast preview, not storage

An agent can build files under `/workspace` in a Cloudflare Sandbox container, start a server with `sandboxStartProcess`, and expose it with `sandboxExposePort`. When no hostname is configured, Garden uses a Sandbox quick tunnel from `sandbox.tunnels.get(port)`. These tools live in `packages/agent-runtime/src/sandbox-tools.ts`.

This gives a fast loop for web pages, prototypes, and dashboards. But quick tunnel URLs are temporary. They change or die when the container restarts. Files are not copied to R2, and no database row links the output to a chat or run.

## Previews carry, storage keeps

Quick tunnels are a preview transport. R2 and Postgres are artifact storage. Work products are reviewable outputs. A generic `artifact` model, with versions in R2 and an optional live preview, would let a sandbox build become durable once someone accepts it. That model is not built.
