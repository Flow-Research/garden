# Garden Mail: product intent, implementation map, and gap research

Research date: 2026-08-10. This report checks the implementation on `feat/garden-mail`, the installed Alchemy source, Cloudflare and Google primary documentation, standards, and the pinned source clones of Agentic Inbox and OpenShip. It supersedes claims in the earlier handoff where the code or provider has since made them stale.

## Executive answer

Garden Mail is the company-domain mailbox inside Garden. It is not an agent add-on to Gmail and it is not Cloudflare AgentMail with a different UI. A workspace connects a company domain, creates personal/shared/agent-led mailboxes, grants humans and agents access, and then collaborates on the same conversations. Agents may read, classify, draft, request approval, and send subject to mailbox access and external-action policy. Every author, editor, approver, sender, assignment, and delivery result remains attributable.

The durable product boundary is already the right one:

> Garden owns mailbox truth; a transport only moves messages.

Garden's Postgres and object storage therefore remain canonical for domains, addresses, mailbox access, messages, MIME, attachments, drafts, approvals, delivery history, read/archive state, assignments, and audit. Cloudflare Email Service is the managed transport now. A later Postfix adapter should receive into and send from those same Garden records. This is how the product can become mail-transport self-hostable without first turning OpenShip's Maildir or Cloudflare Durable Objects into the mailbox database.

The present branch is a substantial vertical, not a mockup: schema, Effect services, inbound MIME ingestion, R2 content, threading, permissions, collaborative drafts, approval, durable delivery workflow, Cloudflare send/receive, settings, agent APIs, and Inbox UI exist. It is not yet a production replacement for a company's Gmail deployment. The blocking gaps are operational domain ownership/onboarding, lifecycle-event ingestion, migration, abuse/security controls, attachments/search/admin lifecycle, and production proof under real provider limits.

## Product boundary

### What Garden is replacing

“Replace Google Workspace mailbox” means replacing Gmail for mail on company domains: addresses such as `person@company.com`, shared addresses such as `deals@company.com`, the inbox/conversation/composer experience, mailbox administration, and the operational migration from Google. It does **not** imply replacing Calendar, Drive, Meet, Google identity, or every Workspace admin feature.

Garden's differentiator is not protocol compatibility. It is one shared work surface where:

- a private executive mailbox can include a human and an assistant agent;
- a shared mailbox can include several members and agents with viewer/editor/owner access;
- an agent can draft, a human can edit, another human can approve/send, and the history retains each action;
- mail and Garden attention items remain filterable views of one Inbox surface, without merging their persistence models;
- removing an agent's access prevents future action without deleting the mailbox's history;
- changing Cloudflare to Postfix changes a provider Layer, not product records or UI.

### Deliberate non-goals for this closure

- Garden does not need IMAP merely to render its own web inbox. IMAP is a remote mailbox-access protocol; sending is a separate submission concern. Add IMAP/JMAP only when Garden promises Apple Mail, Outlook, Thunderbird, or a public mail API. [IMAP4rev2](https://www.rfc-editor.org/info/rfc9051) and [JMAP Mail](https://www.rfc-editor.org/info/rfc8621) are useful future compatibility contracts, not current transport requirements.
- Cloudflare is not canonical storage. Its optional sent-message preview lasts about seven days; Garden must retain its own immutable outbound message and delivery ledger. [Cloudflare domain configuration](https://developers.cloudflare.com/email-service/configuration/domains/)
- The existing Gmail MCP connector is an agent tool, not a tenant migration/synchronization system.
- “Fully self-hostable mail” does not mean the entire Garden product is already self-hostable. The current app still depends broadly on Workers, Workflows, Durable Objects, R2, D1, and Workers AI. This report scopes a portable mail data plane and transport seam.

## What is implemented now

### Canonical model and application

`packages/db/src/schema/mail.ts` defines 19 mail tables. The status and actor vocabularies at lines 22–78 explicitly cover company domains, personal/shared/agent mailboxes, primary/alias/catch-all addresses, member/agent mailbox access, inbound/outbound/imported messages, attributable drafts and activities, attachments, delivery attempts, per-actor state, and assignments. The comment at lines 87–90 already codifies provider-independent ownership.

The server is Effect throughout rather than only at the transport edge:

- `packages/server/src/mail/repository.ts` composes the canonical repository.
- `packages/server/src/mail/ingress.ts`, `mime.ts`, and `content.ts` normalize inbound envelope/MIME, persist raw content and attachments, and thread messages.
- `packages/server/src/mail/draft-application.ts` and `delivery.ts` own draft state, authorization, approval, and provider-neutral delivery.
- `packages/server/src/mail/agent-application.ts:173-195` exposes agent-scoped mailbox listing, conversation listing/reading, draft creation/editing, and delivery requests without accepting a caller-selected workspace or actor. Lines 242–321 bind the server-resolved agent principal and re-check mailbox write access.
- `packages/server/src/mail/repository/contracts.ts:475-486` already exposes idempotent delivery-outcome recording, per-actor state, assignment, and unassignment.

This is the correct core for the product. Do not replace it with Agentic Inbox's per-mailbox Durable Object database or OpenShip's iRedMail tables/Maildir.

### Cloudflare transport and domain control

The app Worker has an inbound `email()` handler, a Cloudflare `send_email` binding, and `MAIL_DELIVERY_WORKFLOW`. `alchemy.run.ts:151-254` provisions the app and binds the workflow at lines 198–201, `EmailSender` at line 211, and the optional mail API token at lines 235–242.

`packages/server/src/mail/cloudflare-domain-provider.ts` is a real Effect adapter. Lines 398–602 call the current Cloudflare endpoints to create/get/delete a sending subdomain, enable/inspect Email Routing DNS, and set a catch-all Worker action. `packages/server/src/mail/provisioning.ts:173-269` checkpoints sending, routing, and catch-all evidence, while lines 272–317 refresh provider state. The settings server boundary obtains the runtime token in `apps/web/src/lib/server/mail-settings-api.ts`.

`packages/server/src/mail/cloudflare.ts` translates the normalized outbound message—including stored attachments—to the Workers send binding. The delivery workflow persists provider acceptance as `submitted`; it does not pretend that acceptance is final delivery.

### Where Cloudflare “AgentMail” helps—and where it does not

Cloudflare's current official surface is the Agents SDK **email communication channel**, not a hosted collaborative mailbox product. It supplies `onEmail`, `sendEmail`, `replyToEmail`, `routeAgentEmail`, address/header resolvers, and HMAC-signed reply-routing headers. It automatically adds agent identity headers and documents typed provider conditions such as unverified sender, rate/daily limit, content size, suppression, and too many recipients. [Agents email channel](https://developers.cloudflare.com/agents/communication-channels/email/) and [email-agent reference](https://developers.cloudflare.com/agents/examples/email-agent/)

Garden can reuse its transport ergonomics and signed reply-routing idea where they deepen the existing adapter. It should **not** route an address directly to one Agent Durable Object or let an agent's session become mailbox storage. In Garden, inbound mail first resolves through domain → address → mailbox → access; canonical conversation state is persisted; then authorized Garden agents may receive work. That is what permits a shared `deals@` mailbox, human review, reassignment, access revocation, and provider portability. Cloudflare's agent-email helpers complement Garden's existing agents; they do not replace Garden Mail.

### Collaboration and UI

The Inbox retains All/Mail/Notifications filters, list/detail presentation, read/star/archive actions, reply/reply-all/forward/compose, attributable human and agent drafts, approval/change requests, retry, and mailbox/domain/access settings. UI patterns are attributed adaptations of the cloned Zero and Cloudflare Agentic Inbox repositories rather than a new visual system.

There are already deeper server capabilities than the UI exposes. Assignment persistence is implemented and conversation detail returns assignments, but the current Inbox has no assignment controls. Inbound attachments can be rendered/downloaded, while outbound compose is not wired: `apps/web/src/features/inbox/components/mail/mail-composer.tsx:50-66,349-353` supports `onAttach`, but the Inbox does not supply it and `apps/web/src/lib/server/mail-api.ts:302-320` writes `attachments: []` and `htmlBody: null`.

Search is local filtering over the currently loaded snapshot (`apps/web/src/features/inbox/components/inbox-page.tsx:290-311`); `getMailInboxSnapshot` loads every visible conversation (`apps/web/src/lib/server/mail-api.ts:106-125`) and the repository list contract has no cursor or query. That will not behave as a mailbox search once history is large.

## IaC, runtime automation, and real prerequisites

The right answer to “can't this be done with IaC?” is: most platform infrastructure can, but dynamic tenant-domain state should not be deployed as static application infrastructure.

| Work | Owner | Why |
|---|---|---|
| App Worker, delivery Workflow, R2, Hyperdrive, send binding | Static Alchemy/IaC | Stable per environment; already provisioned. |
| Delivery-events Queue, Worker consumer, bindings | Static Alchemy/IaC | Stable shared infrastructure. Installed Alchemy exports Queue/consumer resources. |
| Routing/catch-all for a fixed Garden-owned test domain | Static Alchemy/IaC | Installed Alchemy has `EmailRouting`, `EmailCatchAll`, `EmailRule`, `EmailAddress`, and `EmailSender`. Its `node_modules/alchemy/src/cloudflare/email-common.ts:4-10` accepts a hostname and resolves its zone; a typed zone ID is not required. |
| A workspace's domain lookup, ownership connection, sending/routing enablement, catch-all, event subscription, readiness refresh, suspension/removal | Garden runtime control plane | Tenants add/remove domains after deploy. These are product records and auditable customer operations, not application-deploy graph state. |
| Cloudflare zone creation for a Garden-managed account | Garden runtime control plane | The Zones API can create/list zones. The user still controls registrar delegation. [Cloudflare Zones API](https://developers.cloudflare.com/api/resources/zones/) |
| Existing customer Cloudflare-account authorization | Garden runtime control plane plus customer consent | Garden needs scoped OAuth or a customer-created token; the current single operator token is not a multi-tenant authorization design. Cloudflare account administrators may restrict third-party OAuth apps. [Cloudflare OAuth](https://developers.cloudflare.com/fundamentals/oauth/) |
| Registrar nameserver change, domain ownership, MX cutover, DNS propagation | Customer/operator prerequisite | No Cloudflare API can mutate a registrar Garden does not control. Cloudflare's add-site flow ends with nameserver changes. [Add a site](https://developers.cloudflare.com/fundamentals/manage-domains/add-site/) |
| Workers Paid/Email Sending entitlement, reputation ramp, quota increase | Account/provider prerequisite | Code can detect and explain these gates, not grant them. [Email Service overview](https://developers.cloudflare.com/email-service/) and [limits](https://developers.cloudflare.com/email-service/platform/limits/) |
| Google Workspace organization migration consent | Customer prerequisite | A super admin must authorize domain-wide delegation or users must grant OAuth. |

### The current onboarding form asks for infrastructure trivia

`apps/web/src/features/settings/components/mail-domain-settings.tsx:45-67,101-128` requires domain, Cloudflare zone ID, and Worker name. Only the domain and ownership/account path are product inputs:

- Cloudflare's zone-list endpoint can filter by exact name and returns the ID and status. [List zones](https://developers.cloudflare.com/api/resources/zones/methods/list/)
- Installed Alchemy itself proves hostname-to-zone lookup is supported.
- Worker name is Garden deployment configuration (`deployTarget.workerName`), not customer knowledge.

Replace the form with: **domain → choose “Garden manages DNS” or “connect existing Cloudflare account” → authorize/prove control → show observed readiness and cutover instructions**. Never ask for a zone ID or deployed Worker name.

The customer-facing work should be only:

- **Garden-managed DNS:** enter the domain, make the one-time nameserver change at the registrar, and wait for Garden to observe the active zone. Garden performs every Email Service/routing/catch-all operation after that.
- **Existing Cloudflare account:** select “Connect Cloudflare,” consent to narrow scopes, select/confirm the discovered domain, and approve the MX cutover warning. Garden performs the API work. This path depends on resolving the Worker account topology below.
- **Moving from Google:** a Workspace super admin authorizes the migration, chooses users/mailboxes and a cutover window, then changes/approves MX when Garden reports the import and transport healthy.

Everything else—IDs, DNS record construction, rule names, Worker names, polling, retries, and teardown—is product automation or operator observability.

There is one account-topology decision to prove before arbitrary customer onboarding. Cloudflare's routing rule API accepts a `worker` action whose value is a Worker name, and the rule is scoped to a zone. The public reference does not document cross-account Worker targeting. It is therefore unsafe to assume a customer-owned Cloudflare zone can invoke Garden's centrally deployed Worker. [Email Routing API](https://developers.cloudflare.com/api/resources/email_routing/) Garden must live-test this exact case and then choose one supported topology:

1. preferred if required by Cloudflare: place mail zones in a Garden-controlled Cloudflare account (customer delegates nameservers), so the central ingress Worker and zones share an account;
2. or deploy a minimal authenticated relay Worker into the customer's authorized account;
3. or use a documented cross-account mechanism if Cloudflare confirms one.

This is a provider topology question, not a reason to move mailbox truth into Cloudflare.

## What Cloudflare can automate today

Cloudflare can automatically add the sending and routing DNS records during onboarding. Sending and routing have separate DNS/readiness state, and Email Routing at the root conflicts with external MX servers. [Domain configuration](https://developers.cloudflare.com/email-service/configuration/domains/)

| Capability | Current provider/API reality | Garden state |
|---|---|---|
| Zone lookup | `GET /zones?name=…` returns ID/status/nameservers. | Missing; UI requires ID. |
| Zone creation | Zones API supports creation; registrar delegation remains external. | Missing ownership path/state. |
| Sending domain onboarding | Email Sending API exposes sending-subdomain create/get/delete and DNS inspection. Creating can re-enable an existing entry and enables zone sending when entitled. [Create sending subdomain](https://developers.cloudflare.com/api/resources/email_sending/subresources/subdomains/methods/create/) | Adapter calls it, but sends the workspace domain directly. Prove apex behavior in a real account because the REST resource is named “subdomain” while dashboard/domain docs support zone apex onboarding. Do not mark arbitrary domains production-ready until this test passes. |
| Routing DNS | Email Routing DNS endpoints enable/inspect/disable and return missing records. | Enable/inspect exists. Expected/actual DNS is not preserved or shown. |
| Catch-all Worker rule | Catch-all GET/PUT fully support `worker` actions. | Configure exists. Refresh does not inspect it. |
| Domain verification | Sending DNS endpoint and routing state expose readiness; records may be locked or unlocked while valid. | `domainStatus` only combines sending/routing. At `provisioning.ts:246-269`, catch-all is configured but not part of active-state calculation. Lines 288–315 refresh only sending/routing, so a deleted/misdirected catch-all can still appear active. |
| Delivery events | Email Sending publishes delivered, deferred, bounced, failed, rejected, and complained events to Queues, scoped per sending domain. Routing/inbound events are not included. [Email event subscriptions](https://developers.cloudflare.com/email-service/platform/event-subscriptions/) | Delivery schema/repository is ready for the first four plus failed, but no Queue, subscription, or consumer exists; statuses omit rejected/complained. |
| Event subscription CRUD | `POST/PATCH/GET/DELETE /accounts/{id}/event_subscriptions/subscriptions` is public. [Create event subscription](https://developers.cloudflare.com/api/resources/queues/subresources/subscriptions/methods/create/) | Installed Alchemy 0.93.12 has Queue/consumer resources but no Cloudflare event-subscription resource. More importantly, the current generic API schema and Wrangler source do not yet enumerate the documented `email.sending` source payload. Do not invent a request shape: prove dashboard/API behavior with Cloudflare, then encode the observed contract. Until Cloudflare publishes it, use Email Service analytics/logs only for operator reconciliation—not as fabricated per-message delivery truth. |
| Worker binding | `EmailSender` is an explicit binding and already provisioned. | Done. |
| Quotas/limits | New accounts start with conservative daily quotas that scale; 50 recipients/message; general messages 5 MiB, verified recipients 25 MiB; 30 combined routing/sending domains per zone; inbound 25 MiB; 200 routing rules/domain. [Limits](https://developers.cloudflare.com/email-service/platform/limits/) | No preflight enforcement, admin visibility, or capacity policy. No documented Email Service quota-management API was found; entitlement/raises remain operator/provider work. |
| Bounces/suppressions | Cloudflare has suppression behavior and now lifecycle events. [Suppressions](https://developers.cloudflare.com/email-service/concepts/suppressions/) | The handoff's statement that Cloudflare “handles bounces” is incomplete. Garden must consume events to make delivery truth visible and stop/review retry behavior. |

Static `EmailRouting`/`EmailCatchAll` in Alchemy are useful for Garden-owned fixed environments, but must not become a second authority for domains also mutated by the Garden settings control plane. Pick exactly one owner per resource. Current Alchemy documentation now includes a [`Cloudflare.Email.SendingSubdomain`](https://alchemy.run/providers/cloudflare/email/sendingsubdomain/) resource, but this repository's installed 0.93.12 source does not; upgrading would help fixed deploy-time domains, not remove the runtime control-plane requirement.

## Actual production gaps

### P0 — prove mail flow and domain ownership

1. **Define the domain state machine.** Replace the loose status/evidence blob with typed phases: ownership authorization, zone pending nameservers, zone active, sending DNS pending/ready, routing DNS pending/ready, catch-all pending/ready, event subscription pending/ready, active, suspended, failed/removing. Preserve expected and observed records plus timestamps and actionable provider errors.
2. **Automate zone discovery and account authorization.** Remove zone ID/Worker name from the UI. Add a Garden-managed-zone path and an existing-Cloudflare-account authorization path. Store scoped credentials per connected account, encrypted and revocable; do not reuse one Garden operator token for customer-owned accounts.
3. **Prove provider topology and apex onboarding.** Live-test: apex sending domain creation, DNS records, a customer-owned zone targeting the central Worker, catch-all delivery, outbound delivery, and removal. This test chooses the account topology above.
4. **Complete domain lifecycle.** The provider contract has sending deletion, but the provisioning application exposes no suspend/remove domain operation. Add dependency previews, disable-before-delete, catch-all/routing/event-subscription teardown, idempotent resume, and audit. Keep history readable when a domain is suspended.
5. **Add delivery-event infrastructure.** Provision Queue/consumer statically. First capture Cloudflare's supported Email Sending subscription request in a real account because its published event-subscription API/tooling schema lags the Email Service event documentation; then create/delete a subscription per sending domain at runtime, validate the event schema, deduplicate by `eventId`, map provider `messageId` and recipient to the existing attempt, and record terminal/non-terminal results. Model `rejected` and `complained` explicitly rather than collapsing valuable policy signals into generic failure.
6. **Enforce provider limits before dispatch.** Validate recipient count and encoded MIME size, give a deterministic UI error, and add per-domain/workspace rate/capacity policy. Provider quota exhaustion must become a typed operational state, not repeated blind workflow retries.

### P0 — security and trust

1. **Quarantine before agent action.** Inbound internet content is untrusted input. Add spam/phishing/malware policy, attachment type/size scanning, and a separate “safe for agent automation” outcome. Store suspicious mail but do not automatically expose its instructions to tools or auto-send workflows.
2. **Prompt-injection gate.** Agentic Inbox's pinned source stores mail but fail-closes auto-drafting when its injection scanner fails (`cloudflare/agentic-inbox@48039bb`, [`workers/lib/ai.ts:24-58`](https://github.com/cloudflare/agentic-inbox/blob/48039bb6785af34e592c2966f87cde2b255c4c80/workers/lib/ai.ts#L24-L58)). Reuse the product rule—not necessarily its single-model classifier: scanner uncertainty blocks automation, not mailbox visibility; scan quoted thread context too.
3. **Block remote tracking by default.** The message iframe sanitizes HTML and applies CSP, but permits remote HTTPS images. Proxy or suppress remote images until the viewer consents, and strip active/unsafe URL schemes.
4. **Abuse and audit controls.** Rate-limit sends per actor/mailbox/domain, retain policy/approval evidence, prevent agents from widening their own mailbox access, and provide an operator kill switch. Cloudflare Email Sending is positioned for transactional/agent email and remains beta; broad employee correspondence needs explicit provider/acceptable-use validation. [Email Service overview](https://developers.cloudflare.com/email-service/)

### P0 — migration from Gmail

Build a dedicated migration application, not a loop around the Gmail MCP connector:

1. A Workspace super admin authorizes read-only Directory and Gmail scopes through domain-wide delegation, or each user authorizes OAuth. Domain-wide delegation allows a service account to impersonate users only after the super admin grants explicit scopes. [Domain-wide delegation](https://developers.google.com/identity/protocols/oauth2/service-account)
2. Enumerate all licensed mail users and aliases with the paginated Directory API; `users.list` can query `my_customer` across a multi-domain tenant. [Directory users.list](https://developers.google.com/workspace/admin/directory/reference/rest/v1/users/list)
3. For each user, checkpoint `messages.list`, then fetch each message as `RAW`. The Gmail message resource supplies RFC 2822 raw content, Gmail message/thread IDs, labels, and `internalDate`. [Gmail messages](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages) and [messages.list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list)
4. Ingest through a dedicated `source: imported` boundary that preserves original Gmail IDs/labels/internal date as typed migration metadata while reusing Garden MIME/content/threading. Deduplicate primarily by mailbox delivery plus RFC `Message-ID`/content evidence—not Gmail thread ID, which has no meaning outside Google.
5. Keep Google live while the bulk import runs. Record the latest history ID per user and apply incremental changes until cutover. Gmail says history records are usually available for at least a week but may expire sooner; a 404 requires a full sync. [Synchronize clients](https://developers.google.com/workspace/gmail/api/guides/sync)
6. Prepare Garden mailboxes/aliases, prove inbound and outbound, change MX, perform a final Gmail-history drain, then revoke delegation. Preserve a cutover ledger so retrying cannot duplicate messages.

Google's organization Data Export can provide a bulk archive, but it is not the primary live migration mechanism: it requires super-admin prerequisites, may impose a 48-hour wait, and can take days. It is a recovery/archive option. [Export all organization data](https://support.google.com/a/answer/14339894) Gmail's user export does include message contents, headers, attachments, labels, and settings. [What's included in Gmail export](https://support.google.com/mail/answer/10016932)

### P1 — credible daily mailbox product

- Wire upload/storage/removal for outbound attachments and enforce Cloudflare's encoded-message limits. The repository and transport already support attachments; the missing seam is the web upload/composer boundary.
- Add rich-text/HTML compose, signatures/identities, and safe quoted-reply behavior. Current human compose persists plaintext only.
- Move search, filters, and pagination into repository queries. Add stable cursors and indexes; never load an unbounded mailbox snapshot.
- Surface assignment/unassignment in UI and agent APIs. Persistence is already implemented.
- Complete mailbox/address lifecycle: disable/resume, rename implications, dependency preview, and audited removal. The schema has disabled statuses but settings only create mailboxes/addresses and add/remove access.
- Render per-recipient delivery state and bounce/complaint guidance in the conversation/draft activity UI.
- Add contacts/directory autocomplete, aliases, vacation/auto-response policy, storage quotas, retention/export/deletion, and notification preferences. These are normal mailbox expectations; keep them separate from transport.
- Add realtime/new-mail invalidation and background-indexing behavior so the Inbox feels local/warm rather than polling or showing stale snapshots.

### P2 — transport portability and optional clients

- Implement a self-hosted `MailTransport` Layer using Postfix inbound handoff and outbound submission; implement DNS/domain health in the provider Layer.
- Implement an S3/MinIO object-store Layer and documented Postgres deployment/backup/restore. R2-only content storage would otherwise keep the mail data plane hosted.
- Run one provider-neutral conformance suite against Cloudflare and Postfix: multiple local recipients, threading, raw/attachment retention, idempotent send, bounce/defer, domain suspend, and transport switch.
- Add JMAP, or IMAP plus message submission, only if external-client compatibility is a product commitment. Postfix can hand delivery to an external command via `pipe(8)` or an LMTP/non-Postfix store, so Garden need not adopt Maildir. [Postfix overview](https://www.postfix.org/OVERVIEW.html), [`pipe(8)`](https://www.postfix.org/pipe.8.html), and [virtual domains](https://www.postfix.org/VIRTUAL_README.html)

## OpenShip code map: what it actually does

Inspected clone: `oblien/openship@738946188e7c329477a4bbcf9c58dc1451393798`. OpenShip does not allocate SaaS tenant domains from a provider pool. An operator chooses a primary domain for one mail server, the control plane provisions that server, and additional domains are inserted into the same iRedMail installation. Mail addresses are then allocated as iRedMail mailbox/forwarding rows.

### Primary server/domain provisioning

The container path starts an `openship-mail` iRedMail-derived engine plus a `postgres:16-alpine` vmail sidecar. It binds SMTP/IMAP directly on the host network and grants `NET_ADMIN` for fail2ban ([`ensure-container-mail.ts:1-16`](https://github.com/oblien/openship/blob/738946188e7c329477a4bbcf9c58dc1451393798/packages/adapters/src/system/mail/ensure-container-mail.ts#L1-L16)). `FIRST_DOMAIN` seeds the engine; the hostname becomes `mail.<domain>`; first boot writes root-only environment files, starts DB then engine, and proves ports 25 and 993 are listening ([lines 191–211](https://github.com/oblien/openship/blob/738946188e7c329477a4bbcf9c58dc1451393798/packages/adapters/src/system/mail/ensure-container-mail.ts#L191-L211), [257–270](https://github.com/oblien/openship/blob/738946188e7c329477a4bbcf9c58dc1451393798/packages/adapters/src/system/mail/ensure-container-mail.ts#L257-L270), [300–419](https://github.com/oblien/openship/blob/738946188e7c329477a4bbcf9c58dc1451393798/packages/adapters/src/system/mail/ensure-container-mail.ts#L300-L419)). This is server provisioning, not mailbox-product architecture.

### Additional domain selection and DNS

Creating an additional domain validates the operator-supplied name and inserts it into `vmail.domain`; Postfix accepts that domain once the row exists ([`domains.service.ts:108-143`](https://github.com/oblien/openship/blob/738946188e7c329477a4bbcf9c58dc1451393798/apps/api/src/modules/mail/admin/domains.service.ts#L108-L143)). The service then:

1. generates a password and creates `postmaster@<domain>` ([lines 151–190](https://github.com/oblien/openship/blob/738946188e7c329477a4bbcf9c58dc1451393798/apps/api/src/modules/mail/admin/domains.service.ts#L151-L190));
2. SSHes to the server, discovers the install domain/IP/relay state, provisions per-domain DKIM, and builds MX/SPF/DKIM/DMARC ([lines 193–257](https://github.com/oblien/openship/blob/738946188e7c329477a4bbcf9c58dc1451393798/apps/api/src/modules/mail/admin/domains.service.ts#L193-L257));
3. points every additional domain's MX at the primary `mail.<installDomain>` host ([`domain-dns.service.ts:31-88`](https://github.com/oblien/openship/blob/738946188e7c329477a4bbcf9c58dc1451393798/apps/api/src/modules/mail/admin/domain-dns.service.ts#L31-L88));
4. saves the expected DNS bundle and even the generated plaintext postmaster password in an on-server state file until the operator acknowledges it ([lines 93–130](https://github.com/oblien/openship/blob/738946188e7c329477a4bbcf9c58dc1451393798/apps/api/src/modules/mail/admin/domain-dns.service.ts#L93-L130));
5. treats “I've set the records” as a timestamp, not proof ([lines 149–177](https://github.com/oblien/openship/blob/738946188e7c329477a4bbcf9c58dc1451393798/apps/api/src/modules/mail/admin/domain-dns.service.ts#L149-L177)).

The DNS service's top comment still claims DKIM is not automatically provisioned, while the current domain service does provision it. That contradiction is evidence that the OpenShip path is a useful reference, not a ready backend to transplant.

### Mailbox and address allocation

An OpenShip mailbox is three coupled artifacts: `vmail.mailbox`, a self-forwarding row needed for Postfix recipient lookup, and an on-disk Maildir ([`mailboxes.service.ts:1-20`](https://github.com/oblien/openship/blob/738946188e7c329477a4bbcf9c58dc1451393798/apps/api/src/modules/mail/admin/mailboxes.service.ts#L1-L20)). Creation hashes the password, inserts the two database rows in one transaction, creates the Maildir, and compensates the DB if disk creation fails ([lines 159–230](https://github.com/oblien/openship/blob/738946188e7c329477a4bbcf9c58dc1451393798/apps/api/src/modules/mail/admin/mailboxes.service.ts#L159-L230)). Disable mirrors active state to the self-forwarding row; soft delete disables and audits; hard delete removes DB/disk state and protects the primary postmaster ([lines 269–366](https://github.com/oblien/openship/blob/738946188e7c329477a4bbcf9c58dc1451393798/apps/api/src/modules/mail/admin/mailboxes.service.ts#L269-L366)).

Aliases and catch-all addresses are rows in `vmail.forwardings`, read live by Postfix SQL maps. A catch-all is a bare-domain address; per-address aliases can fan out, aliases cannot shadow real mailboxes, and catch-all replacement is atomic ([`aliases.service.ts:1-18`](https://github.com/oblien/openship/blob/738946188e7c329477a4bbcf9c58dc1451393798/apps/api/src/modules/mail/admin/aliases.service.ts#L1-L18), [95–175](https://github.com/oblien/openship/blob/738946188e7c329477a4bbcf9c58dc1451393798/apps/api/src/modules/mail/admin/aliases.service.ts#L95-L175)). Domain deletion previews mailbox/alias dependents, refuses without `cascade`, then hard-deletes artifacts before the domain ([`domains.service.ts:318-397`](https://github.com/oblien/openship/blob/738946188e7c329477a4bbcf9c58dc1451393798/apps/api/src/modules/mail/admin/domains.service.ts#L318-L397)).

### Reuse concepts, not its backend

Reuse these product concepts:

- expected-versus-observed DNS checklist and on-demand health scan;
- domain dependency preview before removal;
- address/mailbox collision guards and exactly one catch-all;
- recoverable disable/soft-delete before destructive removal;
- per-domain send/receive health checks and a transport/relay boundary;
- ordered provisioning with durable checkpoints and explicit partial failure.

Do not copy:

- SSH-driven shell/`psql` administration as Garden's application boundary;
- Maildir, Dovecot users, or mailbox passwords as canonical identities/storage;
- plaintext credential persistence;
- user acknowledgement in place of DNS observation;
- one VPS/primary mail hostname for all tenant operations;
- best-effort catch-and-warn provisioning that leaves product state ambiguous;
- iRedMail's conflated counter/limit columns.

For Garden's future self-hosted adapter, Postfix should accept SMTP and hand raw MIME plus envelope metadata to an authenticated Garden ingest endpoint/queue; outbound Garden messages should submit through Postfix. Add Dovecot only for external mailbox clients. Garden's existing mailbox/address/access/message model stays authoritative.

## False gaps and corrected claims

- **“This cannot be IaC.”** False. Stable platform resources and fixed zones can be Alchemy-managed. Dynamic customer domains correctly belong to an Effect runtime control plane.
- **“The customer must provide zone ID and Worker name.”** False. Zone ID is discoverable; Worker name is Garden configuration.
- **“We need IMAP/SMTP client architecture now.”** False. Garden's web app needs inbound/outbound transport. IMAP/JMAP are external-client compatibility. SMTP is already hidden behind the transport.
- **“Cloudflare must own the mailbox.”** False. Current Garden schema/repository already owns canonical mail.
- **“Bounce tracking is impossible or must be polled.”** False. Cloudflare now publishes lifecycle events. Garden's delivery ledger already has most outcomes; Queue/subscription ingestion is missing.
- **“Cloudflare handles bounces, so Garden is done.”** Also false. Provider handling does not update Garden's user-visible truth without the event consumer.
- **“Agentic Inbox is the backend.”** False. It supplies useful Cloudflare handler, UI, and fail-closed automation-security patterns, but not tenant collaboration, mailbox administration, migration, or portable storage.
- **“OpenShip already solves our self-hosted backend.”** False. It proves operational primitives and Postfix/iRedMail lifecycle concepts, but its canonical Maildir/vmail/SSH design conflicts with Garden's collaboration model and its own source contains stale/unvalidated paths.
- **“Full self-hostability is already achieved by having a transport interface.”** False. The seam is necessary; a tested Postfix Layer, S3/MinIO content Layer, deployment/backup runbook, and conformance suite are still required.

## Prioritized closure plan and exact code seams

### 1. Domain control plane and IaC

- `alchemy.run.ts`: add delivery-events Queue, consumer/binding, and fixed internal-domain resources if desired. If Alchemy gains no event-subscription primitive, add one narrow custom resource rather than dashboard steps.
- `packages/core/src/mail/operations.ts` and `models.ts`: define typed ownership/readiness/lifecycle/event outcomes.
- `packages/db/src/schema/mail.ts`: persist connected Cloudflare account/zone identity, typed readiness evidence or normalized observations, event-subscription identity, lifecycle timestamps, and rejected/complained events.
- `packages/server/src/mail/domain-provider.ts`: deepen the provider port with zone discovery/create/authorization result, inspect catch-all/DNS, subscribe/unsubscribe events, suspend/remove, and capability reporting.
- `packages/server/src/mail/cloudflare-domain-provider.ts`: implement those API operations; stop requiring caller-provided zone/Worker IDs.
- `packages/server/src/mail/provisioning.ts`: make every phase idempotent and checkpointed; active means sending + routing + catch-all + event telemetry ready.
- `apps/web/src/lib/server/mail-settings-api.ts` and `apps/web/src/features/settings/components/mail-domain-settings.tsx`: replace the infrastructure form with ownership connection and readiness/cutover UX.

### 2. Delivery truth and security

- Worker queue handler beside `apps/web/src/server.ts`: decode/deduplicate Cloudflare events and invoke `MailRepository.recordDeliveryOutcome` through an Effect Layer.
- `packages/server/src/mail/ingress.ts`: add a pre-automation classification/quarantine result without weakening immutable raw storage.
- `packages/server/src/mail/agent-application.ts`: add assignment/state tools, attachment access subject to policy, and automation-safety checks.
- mail HTML renderer: default-block/proxy remote images.

### 3. Migration and daily usability

- New `packages/server/src/mail/migration/` deep module: Google tenant discovery, per-user checkpoints, raw import, history drain, dedup, cutover ledger, typed resumable outcomes.
- `packages/db/src/schema/mail.ts`: add typed external migration IDs/checkpoints rather than hiding them in general provider evidence.
- `packages/server/src/mail/repository/queries.ts` and contracts: cursor pagination, server search/filter, assignment filters.
- `apps/web/src/lib/server/mail-api.ts` and Inbox controller/composer: real upload attachment references, HTML, assignment, delivery status, signatures, directory suggestions.

### 4. Self-host transport

- Implement a Postfix `MailTransport`/domain-provider Layer next to the Cloudflare Layers, not a second mail domain model.
- Implement S3/MinIO behind the existing narrow content-store interface.
- Add the provider-neutral conformance suite and an operator runbook covering MX/DKIM/DMARC, TLS/PTR, abuse controls, queue health, backups/restores, and transport cutover.

## Production acceptance gates

Do not call Garden a Gmail mailbox replacement until all of these pass:

1. New company domain can be connected without typing provider IDs; every automated and human prerequisite is visible.
2. Real external mail reaches personal, shared, alias, and catch-all addresses; multiple local recipients do not duplicate canonical content incorrectly.
3. Human and agent collaboration retains access enforcement, revision conflicts, authorship, approval, sender, assignment, and audit.
4. Attachment send/receive, large-message rejection, remote-image privacy, and suspicious-mail quarantine behave deterministically.
5. Provider accepted → deferred/bounced/delivered/rejected/complained transitions arrive idempotently and appear per recipient.
6. Domain suspend/remove preserves history, blocks new traffic, previews dependents, and cleans provider resources safely.
7. A real Workspace tenant migrates with resumable checkpoints, labels/metadata preservation, incremental drain, MX cutover, and no duplicate loss.
8. Load tests prove pagination/search, provider quotas, workflow retry semantics, and mailbox storage limits.
9. Postfix plus S3/MinIO passes the same transport/content conformance suite without schema or UI changes.

That sequence builds the intended product: Garden-owned company mail where humans and agents genuinely collaborate, managed enough to ship now, and architecturally honest about what remains before self-hosting and Gmail replacement are real.
