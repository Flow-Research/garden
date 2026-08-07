# Document artifact parity: Cloudflare Workspace Docs

Evidence baseline: local Cloudflare OS checkout
`Cloudflare OS upstream` at `e1ab8fbd4f609aff7ede9d490bafe1bcf9b2a682`.
The bundled `workspace-docs.gadget` was decoded using the archive format
documented in `packages/workshop-backend/src/blueprint-archive.ts`: 24-byte
header, JSON metadata, then a gzip-compressed Yjs V2 snapshot. Its unnamed
Y.Doc root contains `README.md`, `server.js`, and `client.js`.

## What Yjs does — and does not do

| Boundary                    | Cloudflare OS behavior                                                                                                                                                                                     | Garden adaptation                                                                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workshop source editing     | `overseer.ts` and `agent.ts` replay source-code changes into a Y.Doc; the code editor also uses Yjs.                                                                                                       | Not relevant to document content. Garden does not embed a source-code workspace in each document.                                                 |
| `.gadget` blueprint archive | `workspace-docs.gadget` stores the gadget's three source files as a clean gzip-compressed Yjs V2 snapshot. Cloudflare's own `plans/multi-gadget.md` calls this archive use a future candidate for zip/git. | No Yjs archive is needed. Garden stores product source normally and retains the imported DOCX binary separately from canonical blocks.            |
| Workspace Docs runtime      | Decoded `server.js` imports only `DurableObject`; decoded `client.js` contains no Yjs. Runtime content is a JSON `document:v2` snapshot with ordered HTML blocks and versions.                             | Match the actual runtime: typed canonical snapshots, ordered stable blocks, per-block versions, and serialized DO persistence. Do not add a CRDT. |
| Same-paragraph merge        | Explicitly unsupported in the gadget README: character-level CRDT/OT would be needed for simultaneous edits inside one paragraph.                                                                          | Same limitation. Version conflicts and local-draft preservation are truthful; Yjs would not create upstream parity.                               |

## What Cap'n Web does — and does not do

Cap'n Web supplies the sandboxed browser-to-gadget transport. The browser gets
a `gadget` object-capability stub, calls Durable Object methods, and passes an
`RpcTarget` callback to `subscribe()`. The server duplicates that callback,
removes it on `onRpcBroken`, and broadcasts accepted operations and ephemeral
presence. Cap'n Web provides bidirectional calls, capability references,
promise pipelining, lifecycle, and transport; it does not implement block
versions, conflict resolution, ordering, or document persistence.

Garden is not a sandboxed gadget client. Its equivalent boundaries are:

1. browser commands through the existing typed Effect HttpApi;
2. authenticated Web Worker authorization before any document RPC;
3. native Workers RPC to the owning AgentDO/chat facet;
4. a scoped Effect PubSub in that authoritative facet; and
5. an SSE byte stream back through Effect HttpApi for browser live updates.

This uses the same authority and callback semantics without adding a second RPC
protocol. Native Workers RPC already transfers backpressured `ReadableStream`
values. EventSource owns reconnect, and each reconnect begins with a full
snapshot. No `capnweb` or `yjs` dependency is justified for this surface.

## Behavioral parity matrix

| Behavior                       | Cloudflare Workspace Docs                                                                    | Garden status                                                                                                                                                                                                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical durable snapshot     | Atomic `document:v2` in the gadget DO                                                        | Implemented by `DocumentArtifactRepository` in the chat facet DO.                                                                                                                                                                                                       |
| Atomic programmatic population | `setDocument()` replaces the whole snapshot; `initializeBlocks()` migrates/bootstraps once.  | DOCX import atomically initializes a new canonical artifact. Unconditional replacement remains intentionally unexposed until Garden's existing document-version accept path is moved onto canonical state; silently overwriting collaborative edits now would be wrong. |
| Serialized mutations           | Promise mutation queue                                                                       | `SynchronizedRef.modifyEffect` around DO read/transition/write.                                                                                                                                                                                                         |
| Partial non-conflicting batch  | Valid blocks commit while stale blocks return as conflicts.                                  | Implemented and tested in `document-artifact-engine.test.ts`. `Conflict.committed` distinguishes partial commits from pure conflicts.                                                                                                                                   |
| Per-block conflict             | `baseVersion` checked for upsert/delete                                                      | Implemented.                                                                                                                                                                                                                                                            |
| Ordering                       | Full requested order, last-writer-wins                                                       | Implemented.                                                                                                                                                                                                                                                            |
| Idempotent retry               | Not explicit in the gadget                                                                   | Garden improves this with bounded persisted `operationId` dedupe.                                                                                                                                                                                                       |
| Compact accepted-op broadcast  | Cap'n Web callback broadcasts accepted upserts/deletes/order/title                           | Implemented as typed `DocumentArtifactEvent.Operation` over facet PubSub → Workers RPC stream → SSE. Pure conflicts do not publish.                                                                                                                                     |
| Connect/reconnect consistency  | `subscribe()` returns a snapshot and installs callback                                       | Subscription is installed before snapshot read, buffering racing writes; reconnect emits a snapshot. Revision gaps trigger an HTTP snapshot reload.                                                                                                                     |
| Active local draft             | Remote active-block changes are queued/rebased; DOM/caret is not replaced by status renders. | Uncontrolled memoized blocks preserve DOM/caret. Live reconciliation advances the canonical base while retaining dirty local HTML, so the next save rebases on the latest block version.                                                                                |
| Presence                       | Separate non-persisted callbacks with caret/selection offsets and stale expiry.              | Deliberately omitted from this slice. Presence needs a product identity/caret UI and a client-to-server ephemeral channel; it must remain separate from canonical HTML/storage when added.                                                                              |

## Effect stream guarantees covered by tests

- subscription exists before the initial snapshot effect runs, so a racing
  operation is buffered rather than lost;
- document IDs are isolated on the shared facet PubSub;
- canceling the returned Web stream interrupts/finalizes the scoped Effect
  subscription;
- the HTTP endpoint is declared and served by Effect HttpApi with the same
  authorization service used by reads/writes; and
- a bounded-stream revision gap reloads authoritative state instead of applying
  an incomplete operation chain.

Full Effect Machine reference is present at `refs/effect-machine`, non-shallow,
HEAD `fc0803817ffe5d004588cebb106c0044a809e473`.
