# Cloudflare OS Workspace Docs

`client.js` and `server.js` are byte-identical sources extracted from
Cloudflare OS's bundled Workspace Docs gadget:

- repository: `https://github.com/cloudflare/cloudflare-os`
- repository commit: `e1ab8fbd4f609aff7ede9d490bafe1bcf9b2a682`
- gadget source commit: `f0517773aa6a2f6fbb1281ddbadcca3cb6fd2992`
- archive path: `packages/workshop-backend/format-blueprints/workspace-docs.gadget`
- archive SHA-256: `c8a1326f1b689127242645e6b19fe077fea2e2834cc0206db2ae9581683a254f`
- extracted `client.js` SHA-256: `334f36f458bf527024ae667899be908343ebe17f0cf9232ec0cfdc29246b9e6a`
- extracted `server.js` SHA-256: `7f3113470c29838aae7a652218b1979668540127daac70a63c16e56d9ae40662`

The client runs unchanged in an isolated iframe. Garden supplies the `gadget`
and `RpcTarget` globals outside that source and maps its RPC-shaped calls onto
Garden's authenticated document API routes.

`server-authority.ts` is a typed, attributed adaptation of the exact server's
`sanitizeBlocks`, `setDocumentLocked`, and `applyOperationLocked` functions.
Garden passes current state and time into those functions so the existing
per-thread Durable Object remains the only authority. Storage, serialization,
authenticated Effect HttpApi transport, operation-id dedupe, and event delivery
remain Garden integration code. A parity test evaluates exact `server.js`
against fake storage and compares its results with the adaptation.

Cloudflare OS is licensed under Apache License 2.0. The complete upstream
license is retained at `third_party/cloudflare-os/LICENSE`.
