# Known Gaps

This page answers three simple questions:

1. What must be fixed before the beta?
2. What works for developers but is not ready for production?
3. What still needs research before Garden can run locally, at the edge, or
   across independent providers?

**Last reviewed:** 2026-08-19

**Current release posture:** active development; preparing for a small-user beta

The [roadmap](../roadmap.md) sets the order of work. The linked detail pages
hold the technical evidence. Code and tests decide what is actually available;
plans and meeting notes do not.

## Beta-critical gaps

“Priority” shows how urgently Garden needs the outcome for release. It is not a
security-severity rating from GitHub or a vulnerability report.

| Priority | Public issue                                             | Outcome                                                                                  | More detail                                                    |
| -------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Critical | Security remediation in progress                         | Enforce server-side authority for permission changes                                     | [Auth and access](./auth-and-access.md)                        |
| High     | [#27](https://github.com/Flow-Research/garden/issues/27) | Cross-workspace isolation regression coverage                                            | [Auth and access](./auth-and-access.md)                        |
| High     | Security remediation in progress                         | Safe connector defaults and authorized approval routing                                  | [Connectors](./connectors.md)                                  |
| High     | Tracking needed                                          | Prove tasks and automations finish, fail, cancel, and recover correctly                  | [Issue flow](./issue-flow.md), [Automations](./automations.md) |
| High     | [#33](https://github.com/Flow-Research/garden/issues/33) | Add health checks, end-to-end beta tests, staging, release checks, and useful monitoring | [Infrastructure](./infrastructure.md)                          |
| High     | [#28](https://github.com/Flow-Research/garden/issues/28) | Keep connector permissions and the tool catalog accurate                                 | [Connectors](./connectors.md)                                  |
| Medium   | Tracking needed                                          | Onboarding and failed-run recovery polish                                                | [UI and product](./ui-and-product.md)                          |
| Medium   | [#34](https://github.com/Flow-Research/garden/issues/34) | Make related chats and tasks easy to follow                                              | [Issue flow](./issue-flow.md)                                  |
| Medium   | [#32](https://github.com/Flow-Research/garden/issues/32) | Save run setup, add safe logs, and make important failures reproducible                  | [Prompt and system spec](./prompt-and-system-spec.md)          |
| Medium   | [#31](https://github.com/Flow-Research/garden/issues/31) | Protect automation triggers from fake, repeated, or conflicting requests                 | [Automations](./automations.md)                                |

“Tracking needed” means the gap is documented but does not have a verified
matching public GitHub issue. The older `FLO-*` labels in these documents are
internal work-item names and should not be mistaken for GitHub issue numbers.
Public documents describe security outcomes without reproducing exploit
details. Report vulnerabilities through [the security policy](../../SECURITY.md).

## Current capability boundaries

| Area              | What exists now                                                                                                                | What must not be claimed yet                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Local development | `pnpm offline:up` starts local services; optional Ollama uses `pnpm offline:up:ollama`; `pnpm dev:offline` then starts Garden. | A supported self-hosted product, safe syncing between devices, or permission to take outside actions while offline.                            |
| Managed runtime   | Cloudflare Workers, Durable Objects, Workflows, R2, D1, Sandbox, and Neon support the current development/reference path.      | Provider neutrality, automatic failover between providers, or production portability.                                                          |
| Agents and work   | Chat, issues, automations, skills, documents, connectors, tool grants, and sandboxed execution paths exist.                    | General autonomous management, an organization-wide memory, or unrestricted agent authority.                                                   |
| Work coordination | Garden can show work and supporting evidence.                                                                                  | Complete Workstream orchestration, specialty-based matching, verified-work evidence, reputation-based routing, payments, or automatic rewards. |
| Open source       | The code is available under AGPL-3.0-only and can be studied, changed, and run under that license.                             | A decentralized network, open production access, or a live provider marketplace.                                                               |

## Directional gaps — research, not beta commitments

These are real gaps between the current implementation and the stated
destination. They are not promises that every item will be built, nor reasons
to postpone the beta-critical work above.

### Working locally and syncing later

- Garden cannot yet save and safely sync all offline changes in production.
- Conflicting edits, old permissions, lost devices, encryption, and long
  outages still need clear rules and tests.
- Garden must reconnect and confirm permission before taking an action that
  cannot be undone.

### Running Garden without one cloud provider

- Production behavior depends on Cloudflare-specific Durable Objects,
  Workflows, R2, D1, Sandbox, Workers AI, and related deployment semantics.
- `compose.dev.yaml` is a development convenience, not a supported production
  distribution.
- There is no shared test suite for another provider, supported private
  package, safe upgrade path, or complete managed-versus-private cost study.

### Running work across trusted devices and providers

- Garden cannot yet register outside machines, decide what each may run,
  measure their work, check their results, or remove an unsafe provider.
- The system does not yet prove which data and workloads may run on which
  devices, regions, providers, or trust levels.
- Garden and general AI models must not be the emergency-control system for a
  factory or machine. Physical systems need independent local safety controls
  and qualified owners.

### Open resource and value layers

- There is no live market for compute, storage, inference, skills, agents,
  connectors, verification, or hosting.
- Open registration must not become unrestricted execution. Untrusted nodes
  are initially suitable only for public, low-risk, independently verifiable
  work whose failure can be safely rejected.
- Garden's technical usage records do not decide prices, hold money, approve
  contributions, or assign reputation.

### Economic incentives

- Current points are recognition records, not an automatic promise of cash,
  equity, governance power, mutual credit, or tokens.
- A first reward pilot needs money set aside in advance, clear rules, proof of
  completion, human approval, normal payment services, a dispute process, and
  a stop rule.
- Mutual credit or crypto remains optional later research. It requires proven
  exchange demand, separate governance and legal/accounting treatment, and a
  clear reason ordinary regulated payment rails and portable receipts are
  insufficient. Garden must remain useful without a token.

### Workstream orchestration

- Workstream's target role is broader than record keeping. It should help
  divide an outcome into clear tasks, match people and agents by specialty,
  coordinate connected work, and bring the results back together.
- Matching may use availability, relevant experience, proof from completed
  work, and reputation within the specific kind of work. It must not reduce a
  person to one permanent global score.
- AI may recommend a plan or shortlist. Clear rules and accountable people
  still approve important assignments, acceptance, payment, and reputation
  changes that could affect future opportunities.
- This orchestration and routing system is not complete in Workstream v0.1 and
  must not be presented as a current Garden capability.

## Area index

| File                                                         | Scope                                                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------ |
| [auth-and-access.md](./auth-and-access.md)                   | Better Auth, permissions, and workspace isolation                  |
| [agent-runtime.md](./agent-runtime.md)                       | Runtime topology and shared-resource decisions                     |
| [automations.md](./automations.md)                           | Trigger contracts, concurrency, and durable-run proof              |
| [infrastructure.md](./infrastructure.md)                     | Health, staging, beta smoke, release, backup, and restore coverage |
| [issue-flow.md](./issue-flow.md)                             | Run lifecycle and issue/chat relationships                         |
| [prompt-and-system-spec.md](./prompt-and-system-spec.md)     | Run setup, safe logs, and repeatable checks                        |
| [realtime-sync.md](./realtime-sync.md)                       | Current realtime boundary and future synchronization research      |
| [runtime-sandbox-codemode.md](./runtime-sandbox-codemode.md) | Codemode, container Sandbox, and filesystem boundaries             |
| [ui-and-product.md](./ui-and-product.md)                     | Onboarding and recovery polish                                     |
| [deferred.md](./deferred.md)                                 | Post-beta ideas and open design questions                          |
| [connectors.md](./connectors.md)                             | Connector-specific inventory and policy gaps                       |

## Updating this index

- Prefer code, tests, public issue state, and dated operational evidence over
  meeting aspiration.
- Label every statement as current capability, active work, experiment, or
  long-term direction.
- Move completed gaps out of the active table when the merged code and tests
  prove closure; closing an issue without that evidence is insufficient.
- Do not convert economic or decentralization research into product claims
  without an accepted implementation decision and measurable gate.
