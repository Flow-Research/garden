# Third-party notices

This file covers source incorporated or regenerated directly in Garden. It is
not yet a complete inventory of every transitive package installed by the
workspace package manager.

## Bundled agent skills

Garden includes a curated set of development-time agent instructions under
`.agents/skills`. Their exact upstream repositories, local treatment, and
primary license evidence are recorded in
`third_party/agent-skills/UPSTREAM.md`. Complete upstream license files are
bundled under `third_party/agent-skills/`.

Copies without a verifiable redistribution grant were removed during OSS
preparation. These instructions are not part of Garden's application runtime.

## Cloudflare OS Workspace Docs

Garden incorporates Cloudflare OS's embedded Workspace Docs browser client and
server authority. The extracted sources are retained byte-identically at
`third_party/cloudflare-os/workspace-docs/client.js` and
`third_party/cloudflare-os/workspace-docs/server.js`. Reference:
`cloudflare/cloudflare-os`, file
`packages/workshop-backend/format-blueprints/workspace-docs.gadget`, commit
`f0517773aa6a2f6fbb1281ddbadcca3cb6fd2992`.

Cloudflare OS is licensed under the Apache License, Version 2.0. The complete
upstream license is included at `third_party/cloudflare-os/LICENSE`.

Garden's integration is modified: the upstream client runs in an isolated
iframe; an external adapter maps its Gadget RPC vocabulary onto authenticated
Effect HttpApi GET/POST/SSE routes; Effect Schema defines the contracts;
`SynchronizedRef.modifyEffect` serializes Durable Object storage transitions;
operation ids are deduplicated; and DOCX ingestion uses Cloudflare Workers AI
`toMarkdown` plus structural HTML sanitization, matching Cloudflare OS's own
document-conversion boundary. The typed `server-authority.ts` adaptation mechanically
retains upstream `setDocumentLocked`/`applyOperationLocked` mutation behavior
while composing it into Garden's existing per-thread Durable Object instead of
introducing the gadget's second Durable Object.

## Cloudflare Agents

Garden carries `patches/agents@0.17.3.patch`, which modifies Cloudflare Agents
distribution files used by the MCP session runtime. The patch changes replay,
delivery acknowledgement, Durable Object storage handling, SSE rotation, and
priming-event behavior.

Upstream: https://github.com/cloudflare/agents

The upstream MIT license, NOTICE, and third-party license inventory are
included unchanged under `third_party/cloudflare-agents/`.

## Cloudflare Agentic Inbox

Garden's mail UI uses interaction and component patterns adapted from
Cloudflare Agentic Inbox at upstream commit
`48039bb6785af34e592c2966f87cde2b255c4c80`. Adapted surfaces include the
mailbox split view, folder navigation, accessible conversation rows, message
toolbar, thread and draft presentation, compose states, loading and empty
states, and sandboxed email-body rendering. Garden replaces the upstream
router, state, data, authentication, and agent implementations with its own
workspace, Effect, and mail-domain boundaries.

Upstream: https://github.com/cloudflare/agentic-inbox

Copyright (c) 2026 Cloudflare, Inc.

Licensed under the Apache License, Version 2.0. The upstream license is
available at https://github.com/cloudflare/agentic-inbox/blob/48039bb6785af34e592c2966f87cde2b255c4c80/LICENSE.

## OpenShip Mail

Garden retains a byte-identical snapshot of OpenShip's mail application module
and mail-administration dashboard at upstream commit
`738946188e7c329477a4bbcf9c58dc1451393798`. The snapshot is stored under
`third_party/openship/mail`; provenance and Garden's adaptation rule are recorded
in `third_party/openship/UPSTREAM.md`.

Garden adapts OpenShip's mail settings information architecture, setup progress,
DNS readiness, domain dependency, mailbox/alias lifecycle, and health patterns.
Garden does not adopt OpenShip's SSH/iRedMail/Maildir data model as canonical
mail storage.

Upstream: https://github.com/oblien/openship

Licensed under the Apache License, Version 2.0. The complete upstream license is
included at `third_party/openship/LICENSE`.

## Executor

Garden uses Executor v1.5.40 from upstream commit
`b029643641832ef5f9b0d4ff263d96e1a5b2739c`. The public SDK and plugins are
normal package dependencies. Exact upstream source retained under
`third_party/executor` supplies only unpublished Cloudflare MCP/Durable Object,
dynamic-runtime, encrypted-secret, toolkit, and preset surfaces. Garden's
documented changes adapt those sources to one in-process Worker runtime and
bound result envelopes.

Upstream: https://github.com/UsefulSoftwareCo/executor

Copyright (c) 2026 Rhys Sullivan

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## shadcn/ui

Garden's files under `packages/ui/components/ui` and
`packages/ui/hooks/use-mobile.ts` were regenerated from the official shadcn/ui
registry and then adapted to Garden's package boundaries.

Copyright (c) 2023 shadcn

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Zero Email

Garden's mail UI uses interaction and component patterns adapted from Zero
Email at upstream commit `64c5480c341750578da0746f2db9ad84da686334`.
Adapted surfaces include compact Inbox scope tabs, search and filter controls,
dense conversation rows, bulk-selection mode, thread presentation, inline
reply, composer fields and attachments, and mail-specific loading states.
Garden excludes Zero branding, marketing, billing, authentication, routing,
analytics, and AI product surfaces.

Upstream: https://github.com/mail-0/zero

MIT License

Copyright (c) 2025 Zero Email

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
