---
title: The roadmap puts a dependable beta before portability
description: What Garden works on now, what comes next and later, and what is deliberately deferred or out of scope.
status: current
owner: "@Umoren"
last_reviewed: 2026-11-03
---

Garden is a shared workspace where people and AI agents chat, manage work, use tools, create documents, and ask for approval before sensitive actions. It runs mainly on Cloudflare and is preparing for a small beta. The current horizon is a dependable beta for a small group of users and internal testers.

The long-term direction is local-first, edge-native, cloud-optional, and progressively decentralized. People and organizations should be able to run and extend Garden without depending on one cloud company, one operator, or one payment model. In this roadmap the four terms mean:

- **Local-first.** Useful work stays available on your own device and syncs clearly when a connection returns.
- **Edge-native.** Work runs close to the people, data, or machines that use it.
- **Cloud-optional.** Managed cloud stays available, but it is not the only way to run Garden.
- **Decentralized.** Independent operators run different parts of the system and earn from the value they provide. Open-source code alone is not enough.

These are target properties. None of them describes the current beta.

## Now: a dependable beta

Garden must work reliably for a small group without leaking data, getting stuck, repeating actions, or failing without explanation.

### P0 work must land before the beta

1. **Access and approval safety.**
   - Better Auth origin and cross-site request-forgery checks are restored and covered by focused tests. This item is done.
   - Complete cross-workspace isolation coverage across routes, agent calls, inbox, approvals, documents, and attachments ([#27](https://github.com/Flow-Research/garden/issues/27)).
   - Require explicit server-side authority before a member changes agent permissions. Send approval requests only to authorized reviewers. Track vulnerability details through [the security policy](../../../SECURITY.md) until the fix is deployed.
   - Keep risky-tool approval paths closed when authorization, audit, or write operations fail.
2. **Runs finish and recover.**
   - Test every important run path: start, pause, resume, cancel, fail, and recover.
   - Prevent duplicate starts and stuck work. Show why a run failed.
   - Keep one recovery system until real evidence shows that a second one is needed.
3. **Confidence before release.**
   - Add a health check and simple end-to-end tests for the beta ([#33](https://github.com/Flow-Research/garden/issues/33)).
   - Cover sign-in and workspace creation, chat, issue runs, automation runs, approvals, and document artifacts.
   - Test backup, restore, release, and recovery before calling the beta ready for production use.
4. **Connector reliability.**
   - Keep tool permissions and the connector catalog accurate ([#28](https://github.com/Flow-Research/garden/issues/28)).
   - Make connector failures visible, attributable, and recoverable.

### P1 work raises beta quality

- Shorten onboarding from sign-up to a useful agent action. Make recovery from a failed run understandable.
- Make it easy to move between related chats and tasks ([#34](https://github.com/Flow-Research/garden/issues/34)).
- Save the setup behind each run, add logs that do not expose secrets, and make important failures reproducible ([#32](https://github.com/Flow-Research/garden/issues/32)).
- Protect automation triggers from fake or repeated requests, and make simultaneous runs predictable ([#31](https://github.com/Flow-Research/garden/issues/31)).
- Polish the interface in small slices driven by internal and partner workflows, not broad speculative feature work.

### The beta is ready when this checklist is complete

- [x] Better Auth origin and cross-site request validation are enabled.
- [x] A newcomer can run Garden locally without a Cloudflare account through the offline development mode.
- [ ] Cross-workspace isolation and permission-management coverage is complete.
- [ ] Core smoke tests pass in continuous integration and staging.
- [ ] Runs have visible, recoverable terminal states with duplicate prevention.
- [ ] Connector failures are explainable and recoverable.
- [ ] Approval and audit paths are trustworthy for risky tools.
- [ ] Backup, restore, release, and rollback procedures are tested.
- [ ] A tester can complete the loop: connect a tool, chat, create an issue, run an agent, approve an action, and review the output.

## Next: earn portability from real use

Garden learns portability from one real workflow. Replacing every Cloudflare service at once would cost more than it teaches. The plan has five steps:

1. List what Garden currently needs from Cloudflare and Neon.
2. Choose one funded or partner-backed workflow with a clear owner, data rules, budget, support plan, and definition of success.
3. Build only the smallest common interface that workflow needs. Keep the current managed version working.
4. Test a private deployment on one machine before considering a cluster. Compare safety, reliability, speed, and total cost.
5. Publish the interface and tests so another operator can provide the same service without changing how Garden behaves.

A valid result may be a working private deployment. It may also be clear evidence that the managed option is still better for that workflow.

Today, production behavior depends on Cloudflare Durable Objects, Workflows, R2, D1, Sandbox, Workers AI, and their deployment semantics. `compose.dev.yaml` is a development convenience, not a supported production distribution. Garden has no shared test suite for another provider, no supported private package, no safe upgrade path, and no complete study of managed versus private cost.

## Then: local and edge operation

This phase makes Garden useful away from a reliable network.

- Save pending local changes securely and sync them clearly when the network returns.
- Show people which changes are pending, accepted, rejected, or in conflict.
- Keep local work useful through network loss, restart, duplicate delivery, stale policy, and constrained devices.
- Place work by privacy, permission, speed, safety, reliability, and total cost. Price alone does not decide.
- Hold every irreversible external action until a current, authoritative approval arrives.
- Keep emergency limits for physical machines local, independent, and predictable. A general AI model or an untrusted computer never controls them.

Garden cannot do any of this in production yet. Conflicting edits, old permissions, lost devices, encryption, and long outages still need clear rules and tests. Garden also cannot yet register outside machines, decide what each may run, measure and check their work, or remove an unsafe provider. Nothing yet proves which data and workloads may run on which devices, regions, providers, or trust levels.

## Later: federated and open resource layers

Garden may eventually use independent providers for compute, storage, AI models, skills, connectors, agents, verification, and hosting. Each service needs an open interface, a named operator, proof that it worked, and a clear way to replace it.

Open participation does not mean unrestricted execution. New community nodes start with public, low-risk, reproducible work whose results can be checked independently and rejected safely. Private data, customer secrets, official records, payment authority, and safety-critical control stay on explicitly approved infrastructure.

A resource market starts only when there is a real buyer or approved budget, a clear piece of work, a way to judge the result, a full cost estimate, and a safe backup option. Garden supplies the workspace and the evidence of execution. It does not become a bank, a payment rail, or a universal economic ledger. Today there is no live market of any kind, and Garden's usage records do not set prices, hold money, approve contributions, or assign reputation.

## Economic incentives follow useful demand

Incentives come after real demand. They never stand in for it. The stages are:

1. **Now.** Contributors may receive recognition for verified work. Current points are not a promise of cash, ownership, voting power, credit, or tokens.
2. **First funded lane.** A sponsor, partner, or customer funds a fixed pool in advance, with clear rules, a fixed budget, proof of completion, human approval, a dispute process, and a stop rule. Normal lawful payment services handle any cash award.
3. **Demand-backed market.** Repeated paid use can support independently operated skills, agents, connectors, inference, compute, storage, and other services. Providers earn for accepted service, not for advertising idle capacity.
4. **Independent operators.** Shared records and tests let different organizations provide compatible services and earn at the layer they run.
5. **Optional later mechanisms.** Mutual credit or crypto is researched only when real exchange shows a problem that contracts and normal payments cannot solve well. Any such system needs separate governance, legal and accounting review, security work, participant protections, and shutdown rules. Garden stays useful without a token.

Where formal coordination is needed, Workstream is meant to turn an outcome into clear pieces of work, route them to people or agents with the right specialty, and bring the results back together. Matching can weigh availability, relevant experience, proof from completed work, and reputation within one kind of work. It never reduces a person to one permanent global score. AI may suggest a plan or a shortlist. Clear rules and accountable people still approve important assignments, acceptance, payment, and reputation changes. Workstream v0.1 does not do this routing yet, and it is separate from Garden's workspace and execution tools.

## Anti-priorities protect the beta

- Do not delay beta hardening to build a token, blockchain, peer-to-peer network, universal scheduler, or generic marketplace.
- Do not describe the offline development mode as production local-first or self-hosted operation.
- Do not replace the working managed path before a second workload proves the minimum portable interface.
- Do not put private, regulated, irreversible, or safety-critical work on untrusted community infrastructure.
- Do not reward node count, agent calls, advertised compute, or tasks created. Measure accepted outcomes, reliability, cost, safety, and repeat demand.

## Deferred and non-goals

The items below are deliberate decisions, not oversights. Open defects in built features live in [known gaps](../../reference/known-gaps.md).

### Deferred until after the beta

| Item | Why it waits |
| --- | --- |
| In-flow skill recommender | Needs stronger skill usage and memory signals. |
| Memory synthesis pipeline | The prompt carries agent, workspace, and skill context. Shared user and agent memory needs a parent-backed or separately modeled store, not inference from thread sessions. |
| Slack-native assistants | Needs a stable runtime across Slack invocation surfaces. |
| Headless mode and mobile approvals | Needs push notifications and a mobile approval flow. |
| Cross-workspace skill marketplace | Skills are workspace-scoped. |
| Browser automation as an agent capability | The runtime focuses on typed connectors, workspace and document tools, codemode, and Cloudflare Sandbox. |
| Sync between the Think workspace and the Sandbox `/workspace` | They are separate stores. An explicit bridge must exist before Garden promises shared files. |
| Multi-board governance and nested organizations | Tenancy is one workspace per company. |
| Provider budgets and a finance ledger | Lightweight approval and audit surfaces exist. Provider-level budgets come later. |
| Prompt and skill invalidation after direct database edits | Garden API writes refresh state. Direct database edits need a versioned invalidation signal. |
| Visual runtime for HTML, SVG, and charts | A target in the [2026-04 system spec](../../archive/specs/2026-04-system-spec.md). No renderer exists. |
| Review Grid, a tabular document-review surface | Depends on more mature document artifacts. |
| Workspace-level artifact tabs and a shared artifact bucket | Documents are owned by a thread. `workspace_id` is an access boundary, not a shared artifact home. |
| Issue recurrence UI, bulk operations, and saved filters | Automations cover recurring work. Single-issue operations cover current volume. |
| Custom category icons and mastery badges | No product pressure yet. |

### Enterprise features wait for v2

| Item | Why it waits |
| --- | --- |
| Enterprise SSO through SAML or Okta | An enterprise conversion feature. |
| On-premises or self-hosted deployment | Expensive to factor. Worth it only when a deal needs it. |
| RBAC beyond owner, admin, and member | Custom roles and per-resource grants. |
| Audit log UI and compliance exports | Audit rows exist in the database. Surfacing and export come later. |

### Garden will not do these

- Replace terminal coding agents or IDE copilots.
- Build a Zapier-scale connector catalog.
- Become a chat-window-only product.
- Pose as a general tool while serving only developers.
- Distribute skills through Git.
- Build custom thread persistence below Think.
- Treat the Sandbox container's `/workspace` as the same store as the Think workspace before an explicit sync bridge exists.

### Open product questions

- Pricing: per user, per workspace, usage-based, or a hybrid.
- The default trust posture for connector grants (`auto`, `allow`, or `ask`) and when to nudge users to change it.
- Which work-entry paths matter at launch beyond manual issues, chat tools, automations, and configured connectors.
- How much shared agent memory and artifact storage belongs to the parent agent and how much is scoped to one thread or run.
