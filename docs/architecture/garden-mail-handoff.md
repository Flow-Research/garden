# Garden Mail architecture handoff

Generated 2026-08-10. No product code was changed during this investigation.

## Objective

Continue designing how Garden should replace its current Inbox with a company-domain email product where humans and agents collaborate. Product should use partially managed infrastructure while being built, while preserving a credible route to full self-hosting later.

The user does not want infrastructure terminology or questions pushed onto them. Translate technical choices into product consequences and make informed architecture decisions from the code.

## Settled direction

The key rule is:

> Garden owns mail; providers only move it.

Garden should own domains, addresses, mailboxes, access, conversations, messages, drafts, attachments, delivery history, read/archive state, assignment, authorship, approvals, and audit.

Cloudflare Email Service can carry incoming and outgoing mail initially. A future self-hosted mail transport can replace Cloudflare without migrating Garden's mailbox data, changing the UI, or changing human/agent permissions.

Do not use Gmail, Agentic Inbox, Cloudflare Agents email instances, OpenShip Maildir, or an external provider as Garden's canonical mailbox.

`Inbox` should be a personalized product projection, not a storage entity:

- Mail is durable communication data.
- Existing Garden inbox rows are attention items generated from tasks, approvals, mentions, blockers, and agent runs.
- The replacement Inbox surface can present mail conversations and attention items together while retaining separate models.

Use explicit mail terminology rather than a premature universal communications abstraction:

- Domain
- Address
- Mailbox
- Mailbox access
- Conversation
- Message
- Draft
- Attachment
- Delivery attempt
- Per-actor conversation state

A mailbox may be personal, shared, or agent-led. Both workspace members and Garden agents can receive access. Every draft, edit, approval, and send should retain actor attribution.

## Garden code map

Workspace: `/home/kixey/agency/garden`

Current Inbox is a notification projection, not email:

- Schema: `/home/kixey/agency/garden/packages/db/src/schema/issues.ts:473`
- Core type: `/home/kixey/agency/garden/packages/core/src/types/inbox.ts`
- Projection: `/home/kixey/agency/garden/apps/web/src/lib/server/inbox-compute.ts:879`
- API: `/home/kixey/agency/garden/apps/web/src/routes/api/inbox.ts`
- UI: `/home/kixey/agency/garden/apps/web/src/features/inbox/components/inbox-page.tsx:263`
- Dock mounting seam: `/home/kixey/agency/garden/apps/web/src/components/shell/workspace-dock/panels.tsx:325`

Existing foundations to reuse:

- Workspace organization/member identities: `/home/kixey/agency/garden/packages/db/src/schema/workspaces.ts`
- Agent identities: `/home/kixey/agency/garden/packages/db/src/schema/agents.ts:25`
- Agent permission vocabulary, including `send_external`: `/home/kixey/agency/garden/packages/core/src/agents/permissions.ts:3`
- Connector risk classification: `/home/kixey/agency/garden/packages/connectors/src/sdk.ts:3`
- Permission request and tool audit infrastructure: `/home/kixey/agency/garden/packages/db/src/schema/capabilities.ts`, `/home/kixey/agency/garden/packages/db/src/schema/audit.ts`
- Runtime approval creation: `/home/kixey/agency/garden/packages/agent-runtime/src/runtime-mcp-controller.ts:900`
- Existing Gmail connector: `/home/kixey/agency/garden/packages/connectors/src/gmail/connector.ts:8`
- Main Worker entry, where an inbound `email()` handler could live: `/home/kixey/agency/garden/apps/web/src/server.ts:297`
- Existing R2 file handling patterns: `/home/kixey/agency/garden/apps/web/src/routes/api/upload-file.ts`, `/home/kixey/agency/garden/packages/agent-runtime/src/documents/document-storage.ts`

Important constraints from `/home/kixey/agency/garden/AGENTS.md`:

- No `try/catch`; use `better-result` and typed outcomes.
- No React `useEffect`.
- Drizzle schema first; generate migrations with `pnpm --filter @garden/db db:generate`.
- Cloudflare Workflows own durable long-running run orchestration.
- Automations are not issues; likewise, mail-triggered agent work should not be smuggled through issue runs without an explicit product reason.
- Existing app is one Cloudflare Worker; do not create a redundant connector or proxy service.
- Read TanStack installed skills before route/loader/server-function changes.
- Commit focused major changes when implementation begins.

Garden is currently Cloudflare-heavy beyond email: Workers, Durable Objects, Workflows, R2, D1, Workers AI. Making all of Garden self-hostable is a broader initiative. This mail architecture should avoid adding further lock-in and should make the mail data plane portable first.

## Proposed deep modules and seams

Keep the public product module small. Likely responsibilities:

- Ingest a normalized incoming message.
- Save/update a draft.
- authorize and send a draft.
- Change conversation ownership/read/archive state.
- Query a viewer's inbox and conversation detail.

Provider variability should be isolated behind two real seams because two implementations are planned:

1. Domain provider
   - Begin domain setup.
   - Report verification/readiness.
   - Remove or suspend the domain.

2. Mail transport
   - Send a normalized outgoing message.
   - Normalize inbound provider events before calling Garden's ingest path.
   - Report delivery, bounce, or rejection outcomes.

Storage must not be part of either provider adapter. Use Postgres for structured mail state and object storage for raw MIME/attachments. R2 is acceptable now; keep the mail object-store interface narrow enough for S3/MinIO later.

Possible code placement, not yet committed:

- `packages/core/src/mail/` — shared schemas and domain outcomes
- `packages/db/src/schema/mail.ts` — canonical records
- `packages/server/src/mail/` — deep product module and repositories
- `packages/server/src/mail/transports/` — Cloudflare adapter now, self-hosted adapter later
- `apps/web/src/features/inbox/` — replacement product surface
- `apps/web/src/server.ts` — Cloudflare inbound email entry

Do not over-generalize all chat, Slack, notifications, and email into one message table. Reuse actor/access/approval language; keep email semantics intact.

## Message flows

Inbound:

1. Transport accepts mail from the internet.
2. Provider adapter normalizes and passes raw content to Garden.
3. Garden resolves domain/address/mailbox and persists message plus attachments.
4. Garden creates or updates a conversation and viewer projections.
5. An outbox/event starts lightweight notifications and any configured agent work.
6. Agent work creates attributable drafts or classifications; it does not silently rewrite the received message.

Outbound:

1. Human or agent creates a persisted draft.
2. Garden checks mailbox access and external-send policy.
3. If manual approval is required, reuse/deepen the existing `send_external` approval vocabulary rather than inventing a mail-only approval system.
4. Transport sends.
5. Garden records queued/delivered/bounced/failed separately from the immutable authored message.

Do not route mail directly from an address to a Cloudflare Agent Durable Object. Resolve through Garden's mailbox/access model, then dispatch to existing Garden agent identities. This preserves shared mailboxes, human collaboration, and authorization.

## External projects

### Agentic Inbox

Clone: `/tmp/agentic-inbox.mHy5hP`

Mapped commit: `48039bb`

Useful reference code:

- Worker/auth/routing: `/tmp/agentic-inbox.mHy5hP/workers/app.ts`
- Inbound parse/store trigger: `/tmp/agentic-inbox.mHy5hP/workers/index.ts:348`
- Per-mailbox agent drafting: `/tmp/agentic-inbox.mHy5hP/workers/agent/index.ts`
- MCP tools: `/tmp/agentic-inbox.mHy5hP/workers/mcp/index.ts`
- Durable Object mail schema/migrations: `/tmp/agentic-inbox.mHy5hP/workers/db/schema.ts`, `/tmp/agentic-inbox.mHy5hP/workers/durableObject/migrations.ts`

Reuse ideas: raw MIME parsing, attachment extraction, threading headers, Cloudflare email handler shape, prompt-injection scanning, draft-first behavior.

Do not reuse as architecture: per-mailbox DO canonical storage, app-wide Cloudflare Access authorization, logical R2 mailbox markers, direct address-to-agent ownership, or its UI wholesale. It has no organization/team collaboration model, no standard mailbox protocol, no real domain provisioning, and no tests.

### OpenShip

Clone: `/tmp/openship.3hjgVr`

Mapped commit: `73894618`

Useful reference code:

- Control-plane mail routes: `/tmp/openship.3hjgVr/apps/api/src/modules/mail/mail.routes.ts`
- Setup orchestration: `/tmp/openship.3hjgVr/apps/api/src/modules/mail/mail.service.ts`
- Domain administration: `/tmp/openship.3hjgVr/apps/api/src/modules/mail/admin/domains.service.ts`
- Mailbox administration: `/tmp/openship.3hjgVr/apps/api/src/modules/mail/admin/mailboxes.service.ts`
- Container adapter: `/tmp/openship.3hjgVr/packages/adapters/src/infra/mail-container.ts`
- Mail engine Dockerfile: `/tmp/openship.3hjgVr/apps/email/Dockerfile`

Use as reference for future self-hosted domain/DNS administration, Postfix delivery, DKIM, spam controls, server provisioning, and operational checks.

Do not adopt Zero webmail because Garden is the client. Do not make OpenShip Maildir/vmail storage canonical. Its newer container path explicitly remains unvalidated, current admin is SSH/psql-based, and the `db-email` target architecture is not wired to runtime.

A Garden-oriented self-hosted adapter can be simpler initially: Postfix receives raw messages and hands them to Garden ingest; outgoing Garden messages go through Postfix. Dovecot/IMAP is only needed if the product later promises Apple Mail/Outlook compatibility.

### Cloudflare Email Service and Agents email

Official docs:

- https://developers.cloudflare.com/email-service/
- https://developers.cloudflare.com/email-service/configuration/domains/
- https://developers.cloudflare.com/email-service/platform/limits/
- https://developers.cloudflare.com/agents/examples/email-agent/

Use Cloudflare Email Service as managed transport/deliverability for early development. It handles domain authentication, inbound routing, outbound sending, retries, bounces, suppression, and reputation.

It does not provide durable mailboxes, inbox UI, company directory, human/agent permissions, drafts, sent history, or inbound mailbox protocols. The Agents SDK provides email lifecycle and reply-routing helpers, not a hosted company email product.

Risks requiring validation before production customer dependence:

- Email Sending is public beta.
- Official positioning focuses on transactional/agent email, not broad employee correspondence.
- Cloudflare DNS is required.
- General outbound messages currently have a 5 MiB limit, 50 recipients, and account quotas.
- Multi-tenant custom-domain onboarding/ownership must be proven operationally; early internal or tightly managed zones are safer than assuming arbitrary customer domains work smoothly.

### Existing Garden Gmail connector

The current Gmail connector exposes search, thread reads, label operations, and draft creation through Google's Gmail MCP. It is an agent tool, not a mailbox synchronization system.

Use it as a transition bridge and possible import source. A production migration path will likely need a dedicated Gmail API importer rather than relying solely on MCP tools.

## Suggested delivery sequence

1. Write an architecture/spec artifact after validating product language with the user; no implementation has started.
2. Define canonical mail schemas and authorization invariants.
3. Implement Garden-owned storage and query/write module with a fake transport.
4. Replace the Inbox surface while preserving current attention items.
5. Add Cloudflare inbound/outbound adapter and delivery ledger.
6. Add member/agent mailbox access, assignment, attributable drafts, and approvals.
7. Add Gmail import/transition tooling.
8. Build self-hosted transport adapter from selected OpenShip patterns.
9. Add optional external mail-client compatibility only if product demand proves it necessary.

Before implementation, test the model with concrete scenarios:

- A private executive mailbox shared with one assistant agent.
- A shared `deals@` mailbox with three members and two agents.
- An agent drafts, a human edits, another human sends: all authorship must remain visible.
- Agent is removed from mailbox while work is running.
- Domain is suspended while drafts and history remain accessible.
- Provider accepts send, then reports bounce later.
- Same inbound message targets multiple local recipients.
- Gmail import deduplicates a conversation that already received new mail in Garden.
- Transport changes from Cloudflare to self-hosted without changing addresses or history.

## Suggested skills

- `domain-modeling` — continue sharpening canonical terms and capture resolved glossary language in `/home/kixey/agency/garden/CONTEXT.md` only after the user agrees.
- `codebase-design` — design the Mail module and real provider seams as deep modules.
- `cloudflare-email-service` — retrieve current Email Service behavior and limits before adapter work.
- `agents-sdk` — only when wiring mail-triggered work into existing Garden agent identities/runtime.
- `better-result` — required once TypeScript mail workflows, domain outcomes, provider failures, or approvals are implemented; inspect bundled source first per repo rules.
- `workers-best-practices` — review the Worker `email()` ingress and bindings before shipping.
- Installed TanStack router/start skills — required before changing routes, loaders, or server functions.
- `lazyweb-design` — required by repo routing rules once the user asks to design or build the replacement Inbox screen.
- `technical-writing` or `client-documentation` — if the next session turns this into an architecture/spec handoff.

## Next-session recommendation

Do not begin UI or transport code immediately. First turn this into a concise architecture spec with:

- settled product language;
- ownership and authorization invariants;
- canonical data model;
- Mail module interface;
- Cloudflare transport interface and event normalization;
- migration phases and explicit non-goals.

Then review that artifact with the user before implementation.
