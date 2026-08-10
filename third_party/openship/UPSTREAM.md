# OpenShip mail source snapshot

Upstream: <https://github.com/oblien/openship>

Pinned commit: `738946188e7c329477a4bbcf9c58dc1451393798`

License: Apache License 2.0. The complete upstream license is retained in
[`LICENSE`](./LICENSE).

## Retained source

`mail/` is a byte-identical snapshot of OpenShip's complete mail application
module and mail-administration dashboard surface at the pinned commit:

- `apps/api/src/modules/mail/`
- `apps/dashboard/src/app/(dashboard)/emails/`
- `apps/dashboard/src/lib/api/mail-admin.ts`
- `apps/dashboard/src/lib/mail-providers.ts`
- `apps/api/test/modules/mail/`
- `packages/adapters/src/infra/mail-container.ts`
- `packages/adapters/src/system/mail/`

The snapshot includes the setup/progress flow, DNS and PTR gates, overview,
domains, mailboxes, aliases, DNS readiness, health, sending, backup, test, and
advanced settings flows together with their server-side operational module.
It also retains OpenShip's container topology/provisioning adapter and mail
regression tests. The separately licensed iRedMail engine payload and its
byte-faithful transport schema are intentionally not bundled here: the pinned
engine Dockerfile describes the installer seam as unvalidated, and that subtree
contains GPL and mixed per-file licensing that must remain a separately shipped
component with its own source/notice process.

## Garden integration rule

Files below `third_party/openship/` are retained unchanged. Garden adaptations
must carry a prominent modification notice and point back to the exact upstream
file. Garden reuses the admin information architecture, expected-versus-observed
DNS presentation, dependency previews, address collision rules, recoverable
mailbox lifecycle, and transport-health concepts. OpenShip's SSH, iRedMail,
Maildir, mailbox-password, and direct `vmail` database implementation remain a
self-host transport reference; they do not replace Garden's canonical
workspace/mailbox/conversation model.

To refresh the snapshot, compare hashes against the pinned paths first, update
the commit here, then review Garden adaptations as an explicit upstream patch.
