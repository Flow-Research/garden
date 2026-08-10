# OpenShip mail UI/settings vendor map

Pinned source: `https://github.com/oblien/openship.git` at
`738946188e7c329477a4bbcf9c58dc1451393798` (local clone
`/tmp/openship.3hjgVr`). The dashboard package and repository root are
Apache-2.0. There are no per-file license headers and no `NOTICE` file in the
clone.

## Recommendation

Use OpenShip as Garden's source for **mail provisioning and day-2 mail-admin
flow**, while Zero + Cloudflare Agentic Inbox remain the source for the actual
Inbox/thread/composer experience. Do not pull OpenShip's Next router, request
client, local component state, or raw Tailwind theme into Garden.

Vendor in two layers:

1. Keep an unmodified, pinned source subset plus the complete upstream license
   under `third_party/openship/`. Add OpenShip and the commit to
   `THIRD_PARTY_NOTICES.md` and correct
   `docs/architecture/garden-mail-ui-sources.md`, which currently calls this
   clone only a Zero-fork drift check and points at a different GitHub org.
2. Mechanically adapt the source components into Garden primitives and
   Effect/TanStack state. Put an `Adapted from OpenShip ... @ 738946...` header
   on adapted files. This keeps provenance explicit and prevents later agents
   from independently rebuilding weaker versions.

## Exact source slices

### A. Pure flow/state code: vendor now

| OpenShip source | What it owns | Closure | Garden seam |
| --- | --- | --- | --- |
| `apps/dashboard/src/app/(dashboard)/emails/_lib/view-gate.ts` + `.test.ts` | One mutually exclusive surface: `admin | list | setup | progress`; a live run or human gate outranks a forced setup route | Pure TS + Vitest | Introduce the equivalent pure domain-onboarding view resolver beside `apps/web/src/features/settings/mail-settings-controller.ts`. Drive it from controller state; do not reproduce conditionals in components. |
| `apps/dashboard/src/components/shared/DnsRecordsView.tsx` | `displayDnsName`, deterministic record ordering, DNS type/priority/required chips, copyable name/value cards | `DnsRecord`, `DnsRecords`, React state, Lucide Copy/Check, i18n | Adapt into the Mail settings component directory using Garden buttons/tokens. Provider data must first expose actual required records; booleans alone are insufficient. |
| `apps/dashboard/src/app/(dashboard)/emails/_components/admin/_shared/data-table.tsx` | Generic dense admin grid, responsive columns, skeleton/empty/action slots | `cn`, Lucide type, local Skeleton | Direct mechanical adaptation is useful once domains/mailboxes exceed card-scale. Garden has no shared table primitive. Use Garden Skeleton and buttons; keep column declarations and row semantics. |
| `.../admin/_shared/status-pill.tsx` | One tone map for active/pending/failed/primary/etc. | `cn`, Lucide type | Prefer Garden `Badge`; copy the single tone mapping, not a second badge primitive. |
| `.../admin/_shared/section-card.tsx` | Consistent `soft` vs `split` admin sections | `cn`, Lucide type | Garden's `MailSettingsCard` is already the same seam. Add split density there rather than duplicating a card component. |

### B. Managed-domain onboarding: adapt now

| OpenShip source | Interaction to preserve | Garden target |
| --- | --- | --- |
| `.../emails/_components/mail-setup-form.tsx` | One dominant setup card plus a compact “what happens”/prerequisites rail; one primary CTA | Replace the current bare empty-state form inside `mail-domain-settings.tsx`. Managed Garden asks only for domain; do **not** expose server, postmaster password, relay credentials, ports, or PTR. |
| `.../emails/_components/mail-progress.tsx` | Live/rehydratable progress, error adjacent to retry, cancel/reset only when valid | Use the anatomy for a domain-provisioning progress surface. Garden's real steps already exist in `packages/server/src/mail/provisioning.ts`: resolve zone → reserve/checkpoint → register/inspect sending → enable/inspect routing → configure catch-all → active. Do not show fake timed steps; expose persisted checkpoints or Workflow events first. |
| `.../emails/_components/mail-sidebar.tsx` and `step-icon.tsx` | Complete plan remains visible, active/failed step is highlighted, retry is colocated, DNS reference collapses after completion | Adapt only the all-steps and collapsed-reference composition. Port-conflict/server-details panels belong only to the future self-host transport. |
| `.../emails/_components/dns-hold-banner.tsx` | Required DNS is a dominant blocking state with records inline and one continue action | For managed Cloudflare zones, Garden should normally auto-configure and never show this. Reuse it only for a genuine ownership/delegation/manual-DNS gate. Delete OpenShip's “provider coming soon” picker; Garden already knows Cloudflare. |
| `.../emails/_components/ptr-hold-banner.tsx` | PTR is deliberately separate from ordinary DNS and says where the action must occur | Self-host transport only. Never show for Cloudflare Email Service managed delivery. |
| `.../emails/_components/admin/welcome-modal.tsx` and `SendTestMailModal.tsx` | Successful setup ends in a real test-mail action and then a sent confirmation | Add a Garden-native “send test” terminal step when outbound delivery API exists. Use Garden Dialog, server validation, Effect result, and no hardcoded external mailbox-provider links. |

The setup flow worth copying is:

`enter domain → show truthful durable steps → stop only for real human action → retry from failed checkpoint → active → send test → day-2 admin`

For managed mode, most steps should complete automatically. For future
self-host mode, OpenShip's full setup chain is the source:

`choose/adopt server → prerequisites → engine deploy → DKIM/DNS gate → PTR gate → TLS → test → admin`

### C. Day-2 settings/admin: adapt in supported slices

Source root:
`apps/dashboard/src/app/(dashboard)/emails/_components/admin/`.

| Component | Pattern | Garden seam/status |
| --- | --- | --- |
| `admin-panel.tsx` | URL-preserved admin context and horizontal scrollable tabs; top-level engine/reputation notices precede tabs | Garden Mail already sits inside a settings tab and a 2xl dialog. Add an inner mail-admin view only for supported surfaces. Initial set: Overview, Domains, Mailboxes. Add DNS/Delivery/Health only with backing contracts. |
| `overview-tab.tsx` | Hero identity/action, mail stats rail, quick links | Domain summary and counts can be derived in `mail-settings-api.ts::loadSnapshot`; useful after multiple domains/mailboxes. Do not copy webmail deploy CTA because Garden Inbox already is webmail. |
| `domains-tab.tsx` | Dense domain rows, active/primary status, create/edit/delete modal, pending-DNS banner | Replace/extend `MailDomainSettings` row. Current Garden controller supports create/refresh only; edit/disable/delete require real domain commands before UI. Keep the current single domain input and human/agent language. |
| `mailboxes-tab.tsx` | Domain-scoped list, local-part + fixed domain field, create/edit, soft vs hard delete | `mail-mailbox-settings.tsx` already has the same address field and adds essential human/agent ownership. Copy table/list density and deletion semantics only after adding typed update/disable/delete commands. Never copy the OpenShip password field into managed Garden mailboxes. |
| `aliases-tab.tsx` | Alias/catch-all list with activation and deletion | Map to Garden `MailAddressSettingsView` and current `CreateAddressDialog`. Garden models alias/catch-all as addresses attached to a mailbox, which is better for collaboration; keep that domain model. Missing operations: enable/disable/delete address. |
| `dns-tab.tsx` | Per-domain selector, expected-record reference, explicit live verify scan, pass/warn/fail/unknown rows with expected vs actual | High-value next surface. Needs new provider-neutral DNS record and verification contracts; `MailDomainSettingsView` currently exposes only `sendingEnabled/routingEnabled/catchAllEnabled`. |
| `health-tab.tsx`, `_shared/logs-drawer.tsx`, `engine-banner.tsx` | One panel-level outage explanation/remedy; component health rows and on-demand logs | Self-host adapter only. Managed Cloudflare health should be provider delivery/routing health, not daemon health. Preserve the “one root condition, one remedy” pattern. |
| `sending-tab.tsx` | Direct-vs-relay explanation, scope all/selected domains, provider config, per-domain identity/DKIM | Future self-host outbound-relay settings. Do not show raw SMTP/SES credential fields in the managed Garden flow. Garden's managed transport is Cloudflare and deployment-owned. |
| `backup-tab.tsx`, `mail-restore-modal.tsx` | Mail-aware backup policy and review → progress restore | Future self-host only; requires mailbox object/content backup contracts. |
| `advanced-tab.tsx` | Protocol details, runtime tools, forget/re-run/purge separation | Future self-host only. Keep destructive actions segregated. Never mix it into normal member/agent mailbox settings. |
| `test-tab.tsx` | Small card opening the reusable send-test modal | Add when send-test command exists. |
| `reputation-banner.tsx` | Temporary domain warm-up guidance | Copy copy/hierarchy only if Garden has an actual provider signal. Do not copy its localStorage-as-authority implementation. |

### D. Long-term self-host transport: preserve exact source, do not surface yet

These files are the source of truth when Garden adds an OpenShip-backed
transport adapter:

- `mail-server-list.tsx`: registered transports, auto-open one, choose among
  many, detach without uninstalling.
- `adopt-mail-modal.tsx`: select server → read-only scan → show evidence →
  idempotent adopt. This is the correct disaster-recovery flow.
- `mail-setup-form.tsx`, `mail-progress.tsx`, `mail-sidebar.tsx`,
  `dns-hold-banner.tsx`, `ptr-hold-banner.tsx`: install workflow.
- `admin/{health,backup,sending,advanced}-tab.tsx`: day-2 operations.
- `apps/dashboard/src/lib/api/mail.ts` and `mail-admin.ts`: DTO inventory only;
  do not port the request client.
- `apps/api/src/modules/mail/mail.service.ts::MAIL_SETUP_STEPS`: current engine
  step catalogue.
- `apps/api/src/modules/mail/admin/dns-scan.service.ts`: expected/actual DNS
  health semantics.

Self-host transport maps cleanly behind Garden's existing provider boundary:
`packages/server/src/mail/domain-provider.ts`. It should become another Effect
Layer, not a UI fork and not OpenShip API calls scattered from React.

## Exact Garden seams

Current UI:

- `apps/web/src/features/settings/components/mail-tab.tsx`: compose the
  top-level state. Add the pure onboarding/admin view resolver here, not more
  boolean branches.
- `.../mail-domain-settings.tsx`: replace the simple form/result row with the
  adapted setup/progress/DNS/test flow.
- `.../mail-mailbox-settings.tsx`: keep human/agent ownership and access. Apply
  OpenShip's scalable table/status/delete patterns around it.
- `.../mail-settings-card.tsx`: extend with OpenShip `soft | split` density.
- `apps/web/src/features/settings/mail-settings-contracts.ts`: add provisioning
  steps, provider-neutral DNS records/checks, and failure/retry fields before
  rendering those source surfaces.
- `apps/web/src/features/settings/mail-settings-controller.ts`: add typed
  pending/retry/delete/update outcomes. Continue returning `better-result` at
  interaction boundaries.
- `apps/web/src/features/settings/mail-settings.queries.ts`: TanStack server
  functions/query invalidation replace OpenShip's `useEffect` fetches.
- `apps/web/src/lib/server/mail-settings-api.ts::projectDomain/loadSnapshot`:
  project provider evidence into UI state.

Current domain/runtime authority:

- `packages/server/src/mail/provisioning.ts::registerDomain` already performs
  the managed steps with durable DB checkpoints after sending and routing.
- `packages/server/src/mail/provisioning-contracts.ts::MailDomainProvisioningEvidence`
  has zone, worker, sending, routing, catch-all evidence.
- `packages/db/src/schema/mail.ts::mailDomain` has status/evidence but no
  explicit current-step/error/run ledger. A truthful live OpenShip-style
  progress UI therefore needs either a canonical provisioning run contract or
  Cloudflare Workflow status/events; it must not guess progress client-side.
- `mailMailbox`, `mailAddress`, `mailMailboxAccess` already preserve Garden's
  important difference: people and agents are first-class mailbox actors.

## Dependency closure

OpenShip's mail UI directly depends on React 19, Next 16 navigation/Link,
Lucide, Tailwind theme classes, its `api`/endpoint client, i18n provider,
Toast/Modal contexts, `ServerSelector`, `DnsRecordsView`, `DropdownMenu`, and a
few infra/restore hooks. Garden already has React, Lucide, Tailwind semantic
tokens, Dialog/Alert/Badge/Button/Input/Select/Skeleton/Tabs, TanStack Query and
Start, Effect, and better-result.

Therefore copy component anatomy and pure helpers, but replace:

- Next `Link/router/searchParams` → Garden settings state or TanStack Router;
- `useEffect` fetching/polling → loaders, query options, explicit refetch, or
  subscriptions;
- `try/catch` → Effect typed errors and boundary `Result.match`;
- OpenShip Modal/Toast/Input/button classes → Garden UI primitives;
- `mailApi`/`mailAdminApi` → shared Garden schemas, server functions, and
  Effect services;
- browser localStorage lifecycle flags → canonical server-side state.

No extra runtime package is required for the useful source slices. Do not add
Next, OpenShip's dashboard package, Kumo, or its API client.

## Do not copy blindly

- `emails/page.tsx` is a 953-line component with many state variables,
  `useEffect`, and `try/catch`. Its state machine idea is strong; its component
  architecture violates Garden rules.
- The clone currently defines eight setup steps in `mail.service.ts`, while UI
  comments/defaults still refer to steps 11/12. Vendor semantic step keys, not
  numeric assumptions.
- `DnsHoldBanner`'s provider picker is a “coming soon” placeholder. Garden's
  Cloudflare provisioning is real; shipping the placeholder would regress it.
- `reputation-banner.tsx` and welcome-seen state use localStorage. They are not
  durable multi-actor workspace state.
- `mail-providers.ts` mixes IMAP providers and send-only SMTP relays and loads
  third-party favicons. It is not Garden's managed transport registry.
- OpenShip mailbox passwords/IMAP/SMTP credentials solve conventional mail
  clients. Garden's first-class mailbox access is member/agent ACLs. Keep both
  concepts separate for eventual external client support.
- OpenShip does not model human/agent collaboration. Garden's
  `MailboxAccessEditor`, actor types, draft approval, and authorship stay.

## Smallest safe implementation order

1. Vendor license + unmodified source subset and update provenance docs.
2. Vendor/adapt pure `resolveMailView`, DNS helpers, table geometry, and tests.
3. Add canonical provisioning-step/error projection to the Effect/domain
   boundary; then adapt setup/progress/retry UI.
4. Adapt OpenShip Overview/Domains/Mailboxes hierarchy while preserving
   Garden's actor access model.
5. Add provider-neutral DNS records + verification; adapt DNS tab.
6. Add real send-test outcome; adapt terminal welcome/test flow.
7. Keep OpenShip server/adopt/PTR/health/backup/relay/advanced slices vendored
   but feature-inactive until the self-host transport Layer exists.

