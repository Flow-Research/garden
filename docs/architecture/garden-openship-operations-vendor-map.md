# OpenShip mail operations vendor map for Garden

Audited source: `https://github.com/oblien/openship.git` at commit
`738946188e7c329477a4bbcf9c58dc1451393798` (local clone
`/tmp/openship.3hjgVr`). This is a code audit, not legal advice.

## Decision

Do not copy OpenShip's mail CRUD wholesale into Garden. Garden's canonical
model is already stronger: one `mail_address` namespace covers primary,
alias, and catch-all addresses; `(domain_id, local_part)` is unique; mailbox,
address, and owner access are created in one database transaction; members and
agents are first-class owners. OpenShip's iRedMail tables are a transport
projection, not the Garden domain model.

Vendor two things instead:

1. **The self-hosted mail engine as a separately licensed payload.** Preserve
   its container/config source intact and put a thin Garden transport adapter
   around it.
2. **The tested operational semantics as pinned source-derived modules.** Port
   the DNS evaluator, domain-deletion preview, topology/health catalog, and
   probe parsers with prominent provenance notices. Replace only their I/O and
   error/runtime shell with Garden Effect services.

This keeps OpenShip's accumulated edge-case work without importing its SSH,
Hono, state-file, `try/catch`, React `useEffect`, or iRedMail-schema coupling.

## Exact vendor/adapt map

| Concern | OpenShip source | Recommendation | Smallest useful closure |
|---|---|---|---|
| Self-hosted Postfix stack | `apps/email/engine/**`, `apps/email/Dockerfile`, `apps/email/docker/{entrypoint.sh,supervisord.conf,build-config}` | **Vendor as a distinct payload**, initially unchanged. Never paste its config generator into Garden TS. | Entire `apps/email/engine/**` plus Dockerfile and all three docker support files. The installer templates/functions are mutually coupled; cherry-picking Postfix alone loses Dovecot SQL, Amavis DKIM, iRedAPD, fail2ban, and schema/config assumptions. |
| iRedMail transport schema | `packages/db-email/src/schema/vmail.ts`, `packages/db-email/drizzle/**` | **Vendor beside the engine, not into Garden DB.** Treat as the self-hosted adapter's projection/schema. | Whole `packages/db-email` `vmail` schema + generated migration. Exclude `mail_app.ts`: it is OpenShip/Zero UI state and conflicts with Garden's canonical message/collaboration model. |
| Container topology constants | `packages/adapters/src/infra/mail-container.ts` | **Port with provenance; retain exact mount/data-loss invariants.** | Constants/types for container names, host state root, mounts, DB paths, ports. Replace `openship-*` names/paths only in a marked modified file. |
| Engine provisioning | `packages/adapters/src/system/mail/ensure-container-mail.ts` | **Adapt, do not blindly copy.** It is the orchestration blueprint for pull-before-stop, bind-mounted durable state, root-only env files, DB-before-engine, port verification, and image rollback. | Depends on executor types, managed-image helpers, local-shell quoting, port-listen, logging, image-ref builder, and container constants. In Garden, make those Effect services and let Cloudflare Workflow own durable steps/retries. Do not duplicate its local retry/recovery layer. |
| Topology detection | `packages/adapters/src/system/mail/detect-engine.ts` | **Adapt behind `SelfHostedMailTransport`.** Preserve container-wins-if-it-exists and `container | host | none` semantics if OpenShip imports are supported. | `detect-engine.ts` + the read-only container detector from `ensure-container-mail.ts` + executor interface + container constant. Omit `startHostMail` until host-native import/repair is in scope. |
| Flavor command matrix | `apps/api/src/modules/mail/mail-engine.ts` | **Port the pure matrix and parsers nearly verbatim, with provenance.** Effect-wrap execution separately. | Pure functions/types: `mailPsqlCommand`, `mailEngineCommand`, `mailConfigFile`, `mailUnitProbeCommand`, `parseMailUnitProbe`, `mailUnitActionCommand`, `mailUnitLogsCommand`, state mappers. Do not bring `sshManager` or `AppError`; replace `runMailCommand`/memoization with an Effect service scoped to one executor session. |
| Daemon health | `apps/api/src/modules/mail/mail-health.service.ts`; tests `apps/api/test/modules/mail/mail-health-probe.test.ts` | **Port catalog + tests.** This is the strongest immediately reusable operations code. | `MAIL_COMPONENTS`, normalized statuses, parser tests, and the rule “unknown probe != missing daemon.” Adapt probing to Garden Executor + Effect. Add provider-neutral health above it so Cloudflare and Postfix produce one Garden view. |
| DNS expected/observed evaluation | `apps/api/src/modules/mail/admin/dns-scan.service.ts`; tests `apps/api/test/modules/mail/dns-scan.service.test.ts` | **Port evaluator semantics, replace resolver/state I/O.** | Copy types/statuses and record evaluators/tests. Replace `node:dns/promises`, singleton `Resolver`, `sshManager`, and `readState` with an Effect `MailDnsResolver` (Cloudflare DoH/API in Workers) plus an explicit expected-record input. |
| DNS record construction | `apps/api/src/modules/mail/admin/domain-dns.service.ts`; `buildSpfValue` in `mail.service.ts`; `withSesInclude` in `outbound-relay.service.ts` | **Use as provider-specific reference, not canonical code.** Cloudflare Email Service owns different expected records than a Postfix host. | For the self-hosted adapter only: `buildDomainDnsRecords` + `buildSpfValue` + relay SPF helper + `DnsRecordSet` types. Persist expected records in Garden evidence, not an SSH state file. |
| Domain dependency preview | `countDomainDependents`, `deleteDomain`, `DomainHasDependentsError` in `apps/api/src/modules/mail/admin/domains.service.ts`; handler in `admin.controller.ts` | **Copy the flow/contract, not SQL.** Read-only preview first; typed conflict includes counts; destructive request must explicitly confirm the same preview. | A new Garden `DomainDeletionPreview` query/result and delete command. Count Garden relationships, not iRedMail rows. Provider teardown belongs to a Workflow, outside the DB transaction. |
| Mailbox/address collision guards | `mailboxes.service.ts`, `aliases.service.ts`, `email-case.test.ts` | **Do not vendor implementation. Garden already supersedes it.** Copy missing regression cases only. | Tests for trim/lowercase, mixed case, alias-vs-primary collision, catch-all uniqueness, exact-idempotent alias creation, and concurrent assignment. Garden's unique address table fixes OpenShip's one-way guard. |
| Maildir layout | `apps/api/src/modules/mail/admin/maildir.ts` | **Vendor into self-hosted adapter only.** | `generateMaildir`, constants, and path-boundary guard. Replace shell mutation with executor operations. Keep stored-path-plus-prefix guard on removal. |
| Raw psql bridge | `apps/api/src/modules/mail/admin/psql-runner.ts`, mailbox SQL builders in `platform-mailbox.service.ts` | **Reference only.** Prefer the vendored Drizzle self-host projection over interpolated SQL over SSH. | If needed during OpenShip import, isolate in a migration adapter; do not expose it as normal Garden persistence. |

## DNS semantics worth preserving

OpenShip has several non-obvious, tested rules that should survive the port:

- Query public DNS, not the mail host's system resolver. `/etc/hosts` may make
  `mail.<domain>` falsely appear as `127.0.1.1` locally.
- Model each result as `pass | warn | fail | unknown`; lookup failure is not
  equivalent to a missing record.
- Multiple SPF records are a hard failure. A present but unauthorized SPF is a
  warning. The Postfix adapter must require its own mechanism; the Cloudflare
  adapter must require Cloudflare's actual expected mechanism rather than
  OpenShip's hard-coded `mx`/SES checks.
- Multiple DMARC policy records are a hard failure. Preserve the version-tag
  parser and its whitespace/case tests. Extend evaluation to policy/alignment;
  OpenShip currently passes any single syntactically identified policy even when
  it differs from expected.
- DKIM TXT comparison must join 255-byte chunks and handle resolvers that return
  chunks as separate records.
- Normalize trailing dots on MX/CNAME/PTR targets.
- PTR is transport-specific. It is essential for direct Postfix delivery but not
  a customer-managed record for Cloudflare Email Service.
- Optional records warn when missing; required records fail.

Recommended Garden contract:

```text
MailDomainHealth
  expectedRecords[]  <- transport adapter declares
  observedRecords[]  <- MailDnsResolver observes publicly
  checks[]            <- source-derived pure evaluator
  transportChecks[]   <- Cloudflare state or Postfix daemon/port checks
  checkedAt
```

Managed Cloudflare setup should advance automatically from observed provider and
DNS state. Keep OpenShip's manual “I've published these” acknowledgement only for
external/self-hosted DNS where Garden cannot mutate the zone.

## Domain lifecycle/deletion flow to adopt

OpenShip's valuable product pattern is the two-step deletion:

1. Read-only dependency preview.
2. Default delete refuses with a typed conflict and exact dependent counts.
3. UI names what will be removed; explicit cascade is a separate action.

Garden's preview must be broader than OpenShip's `{mailboxes, aliases}`:

```text
DomainDeletionPreview
  domain
  addresses: { primary, alias, catchAll }
  mailboxes: { total, exclusivelyAddressedByDomain }
  access: { members, agents }
  drafts: { active, awaitingApproval }
  conversations / messages retained or removed (state the policy)
  providerResources: sendingDomain, routingRule, DNS records
  canDelete
  blockingReasons[]
  previewVersion / observedAt
```

Deletion should be a Cloudflare Workflow/saga: freeze new sends and inbound
routing, remove provider routing/sending resources idempotently, then commit the
local lifecycle transition. Prefer suspension/retention for mailbox history over
OpenShip's immediate Maildir wipe. Require the preview version or an equivalent
precondition so a stale confirmation cannot delete newly added dependents.

Do **not** copy these OpenShip deletion defects:

- Cascades are sequential and can leave a half-deleted domain.
- Primary-domain protection is indirect and UI-dependent.
- Missing domains can appear successfully deleted.
- DNS-state cleanup errors are swallowed.
- Only mailboxes and alias rows are counted.

## Collision model: Garden is already better

OpenShip blocks alias creation over a mailbox because Postfix alias lookup would
win, but `createMailbox` does not symmetrically block an existing alias at the
same address. Its namespace is split across `mailbox` and `forwardings`, so the
guard is inherently race-prone.

Garden's `mail_address(domain_id, local_part)` unique index makes all primary,
alias, and catch-all assignments share one namespace. `persistMailbox` and
`persistAddress` additionally handle concurrent insert races. Keep this. Add
OpenShip's normalization regression tests, but do not regress to two tables or
transport-specific forwarding rows. The Postfix adapter should project each
Garden address to iRedMail `mailbox` + self-forwarding / alias rows.

## Transport health architecture

Use one provider-neutral Garden health contract with two adapters:

- `CloudflareMailTransportHealth`: sending-domain state, routing enabled,
  catch-all Worker rule, public expected/observed DNS, recent delivery/bounce
  telemetry when available.
- `SelfHostedPostfixTransportHealth`: OpenShip's engine flavor plus its daemon
  catalog, serving ports, public DNS/PTR, queue/storage observations.

For the Postfix adapter, preserve these OpenShip invariants:

- Detect topology once per executor session and share the in-flight result.
- A container that exists wins even when stopped because that selects the live
  database, not merely the live process.
- `missing` is a conclusion; Docker/systemd/probe failure is `unknown` with the
  first actionable line retained.
- “Engine exists” and “mail is serving” are separate claims; Postfix and Dovecot
  must both be active.
- Probe/action unit names come from a closed catalog, never caller input.
- Never replay a mutation merely because topology changed underneath it.
- Persistent binds must include mail data, Postfix spool, DKIM private keys,
  mutable daemon config, ClamAV signatures, certificates, and Postgres data.
- Pull before stopping; verify replacement; roll back image on failure.

Do not copy OpenShip's hard-coded timeouts into Garden without platform evidence;
Garden's repository explicitly forbids arbitrary timeout invention. Also do not
copy its `try/catch`/`.catch(() => ...)` recovery style: translate each observed
failure into typed Effect errors and use Cloudflare Workflow for durable
provision/repair execution.

## What is not production-ready upstream

OpenShip itself says the self-hosted email document is **target state, not
current**. Its Dockerfile says the Linux build/invocation is an unvalidated seam,
runs `iRedMail.sh || true`, and notes that the mail image is not published. The
container installer therefore cannot be treated as a production artifact merely
because it exists in source.

Before shipping the vendored engine:

1. Make installer failure fatal; validate on the pinned Debian base.
2. Build/publish a content-addressed image with SBOM and vulnerability scan.
3. Run SMTP receive/submission, IMAPS auth/delivery, DKIM, SPF, DMARC, bounce,
   queue persistence, restart, upgrade, rollback, and restore tests.
4. Pin OS packages and upstream iRedMail commit/release rather than inheriting
   moving package repositories.
5. Decide whether Garden supports legacy host-native OpenShip imports; if not,
   omit that branch from v1 while retaining the source map for an importer.

## Patterns to reject rather than duplicate

- `vmail.domain.mailboxes` / `.aliases` are treated as both limits and live
  counters. Do not copy this conflation; Garden should compute counts and store
  limits separately if it introduces quotas.
- Domain creation spans DB insert, postmaster creation, DKIM generation, and
  state-file persistence with best-effort warnings. Preserve the sequence but
  implement it as a durable workflow with explicit checkpoints/compensation.
- DNS expectation is stored in an SSH-side JSON file. Garden provider evidence
  is the canonical place; use a strict Effect Schema, not loose JSON guesses.
- Manual DNS acknowledgement is not verification. Managed setup should observe
  and advance itself.
- Raw SQL strings over SSH are an import/repair boundary, not the application
  persistence layer.
- OpenShip UI polls with React `useEffect`; Garden bans it and should use its
  loaders/query cache/subscription patterns.

## Provenance and license requirements

The repository root is Apache License 2.0. For copied/modified root-project TS,
Docker, or schema files:

- ship a copy of Apache-2.0;
- retain existing copyright/patent/trademark/attribution notices;
- add a prominent notice to every modified file saying it was changed;
- record source URL and exact commit SHA;
- if an upstream `NOTICE` appears in a future pin, reproduce its relevant
  notices. No root `NOTICE` exists at the audited commit.

The engine subtree is different: `apps/email/engine/LICENSE` and README identify
iRedMail under GPLv3, while individual bundled files explicitly state GPLv2 and
some carry other notices (for example the Amavis schema's GNU Free Documentation
License text). Do not assume OpenShip's root Apache license overrides those files.
Keep the engine as a visibly separate third-party/GPL component; retain every
per-file header and license; distribute corresponding source for the exact image
and modifications; and run a proper license/SBOM scan before release. Have counsel
confirm obligations for the exact trimmed image, especially the mixed GPLv2/GPLv3
files.

Suggested vendored metadata:

```text
vendor/openship-mail/
  SOURCE.json              # repo URL, commit SHA, import date, paths, checksums
  LICENSE.open-ship        # root Apache-2.0 text
  THIRD_PARTY_NOTICES.md   # modified-file notices and attribution
  ops/                     # Apache source-derived pure parsers/evaluators
  engine/                  # separately identified GPL iRedMail payload
    LICENSE
    SOURCE_OFFER.md
```

Every source-derived Garden file should start with a notice such as:

```text
Derived from OpenShip <original path> at
738946188e7c329477a4bbcf9c58dc1451393798, Apache-2.0.
Modified for Garden: Effect services, Worker-compatible I/O, and Garden domain model.
```

For engine files, retain their original upstream headers; do not replace them
with the Apache notice.

## Recommended implementation order

1. Vendor provenance/license scaffolding and the engine payload without wiring it
   into production.
2. Port DNS result types/evaluators + upstream tests behind `MailDnsResolver`;
   use it now for Cloudflare domain health.
3. Add Garden domain deletion preview/typed refusal using Garden relationships.
4. Add provider-neutral transport health and Cloudflare implementation.
5. Port the pure OpenShip engine matrix, daemon catalog, parsers, and tests into
   the future self-hosted adapter.
6. Validate/build the GPL engine image; only then implement its Workflow-backed
   provision/repair path and iRedMail projection writer.

This order immediately improves the managed product while preserving a clean,
non-duplicated path to full self-hosting.
