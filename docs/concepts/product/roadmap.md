# Garden Roadmap

**Current horizon:** dependable small-user beta and internal testing

**Long-term direction:** local-first, edge-native, cloud-optional, and progressively decentralized

**Last reviewed:** 2026-08-19

## What we are building toward

Garden is a shared workspace where people and AI agents can chat, manage work,
use tools, create documents, and ask for approval before taking sensitive
actions.

Garden currently runs mainly on Cloudflare and is preparing for a small beta.
Over time, we want people and organizations to be able to run and extend Garden
without depending on one cloud company, one operator, or one payment model.

In this roadmap:

- **local-first:** useful work remains available on your own device and syncs
  clearly when a connection returns;
- **edge-native:** work can run close to the people, data, or machines that use
  it;
- **cloud-optional:** managed cloud remains available, but it is not the only
  way to run Garden; and
- **decentralized:** independent operators can run different parts of the
  system and earn from the value they provide. Open-source code alone is not
  enough.

These are target properties, not claims about the current beta.

## Now — dependable beta

Garden should work reliably for a small group without leaking data, getting
stuck, repeating actions, or failing without explanation.

### P0 — must land before beta

1. **Access and approval safety**
   - ✅ Better Auth origin and cross-site request-forgery checks restored and
     covered by focused tests.
   - Complete cross-workspace isolation coverage across routes, agent calls,
     inbox, approvals, documents, and attachments
     ([#27](https://github.com/Flow-Research/garden/issues/27)).
   - Require explicit server-side authority before a member changes agent
     permissions, and ensure approval requests reach only authorized reviewers.
     Track vulnerability details through [the security policy](../SECURITY.md)
     until remediation is deployed.
   - Keep risky-tool approval paths closed when authorization, audit, or write
     operations fail.

2. **Runs finish and recover**
   - Test every important run path: start, pause, resume, cancel, fail, and
     recover.
   - Prevent duplicate starts and stuck work, and always show why a run failed.
   - Keep one recovery system until real evidence shows that another is needed.

3. **Confidence before release**
   - Add a health check and simple end-to-end tests for the beta
     ([#33](https://github.com/Flow-Research/garden/issues/33)).
   - Cover login and workspace creation, chat, issue runs, automation runs,
     approvals, and document artifacts.
   - Test backup, restore, release, and recovery before calling the beta ready
     for production use.

4. **Connector reliability**
   - Keep tool permissions and the connector catalog accurate
     ([#28](https://github.com/Flow-Research/garden/issues/28)).
   - Make connector failures visible, attributable, and recoverable.

### P1 — beta quality

- Shorten onboarding from signup to a useful agent action and make failed-run
  recovery understandable.
- Make it easy to move between related chats and tasks
  ([#34](https://github.com/Flow-Research/garden/issues/34)).
- Save the setup behind each run, add logs that do not expose secrets, and make
  important failures reproducible
  ([#32](https://github.com/Flow-Research/garden/issues/32)).
- Protect automation triggers from fake or repeated requests, and make
  simultaneous runs predictable
  ([#31](https://github.com/Flow-Research/garden/issues/31)).
- Continue user-interface polish in small slices driven by internal and partner
  workflows rather than broad speculative feature work.

## Next — earn portability from real use

We will learn portability from one real workflow instead of trying to replace
every Cloudflare service at once.

1. List what Garden currently needs from Cloudflare and Neon.
2. Choose one funded or partner-backed workflow with a clear owner, data rules,
   budget, support plan, and definition of success.
3. Build only the smallest common interface that workflow needs. Keep the
   current managed version working.
4. Test a private deployment on one machine before considering a cluster.
   Compare safety, reliability, speed, and total cost.
5. Publish the interface and tests so another operator can provide the same
   service without changing how Garden behaves.

A valid result may be a working private deployment—or clear evidence that the
managed option is still better for that workflow.

## Then — local and edge operation

- Save pending local changes securely and sync them clearly when the network
  returns.
- Make pending, accepted, rejected, and conflicting changes visible to people.
- Preserve local usefulness through network loss, restart, duplicate delivery,
  stale policy, and constrained devices.
- Place work according to privacy, permission, speed, safety, reliability, and
  total cost—not price alone.
- Keep irreversible external actions waiting for current authoritative
  approval. Emergency limits for physical machines must remain local,
  independent, and predictable—not controlled by a general AI model or an
  untrusted computer.

## Later — federated and open resource layers

Garden may eventually use independent providers for computing, storage, AI
models, skills, connectors, agents, checking, and hosting. Each service should
have an open interface, a named operator, proof that it worked, and a clear way
to replace it.

Open participation does not mean unrestricted execution. New community nodes
begin with public, low-risk, reproducible work whose results can be
independently checked and safely rejected. Private data, customer secrets,
official records, payment authority, and safety-critical control stay on
explicitly approved infrastructure.

Resource markets begin only when there is a real buyer or approved budget, a
clear piece of work, a way to judge the result, a full cost estimate, and a
safe backup option.
Garden supplies the workspace and execution evidence; it does not become a
bank, payment rail, or universal economic ledger.

## Contribution and network economics

Economic incentives follow useful demand; they do not substitute for it.

1. **Now:** contributors may receive recognition for verified work. Current
   points are not a promise of cash, ownership, voting power, credit, or tokens.
2. **First funded lane:** a sponsor, partner, or customer funds a fixed pool in
   advance, with clear rules, a fixed budget, proof of completion, and human
   approval. Normal lawful payment services handle any cash award.
3. **Demand-backed market:** repeated paid use can support independently
   operated skills, agents, connectors, inference, compute, storage, and other
   services. Providers earn for accepted service, not merely for advertising
   idle capacity.
4. **Independent operators:** shared records and tests let different
   organizations provide compatible services and earn at the layer they run.
5. **Optional later mechanisms:** mutual credit or crypto may be researched
   only when real exchange has demonstrated a problem that contracts and
   normal local or international payments cannot solve well. Any such system
   needs separate governance, legal and accounting review, security work,
   participant protections, and shutdown rules. Garden must remain useful
   without a token.

Where formal coordination is needed, Workstream is intended to help turn an
outcome into clear pieces of work, route them to people or agents with the
right specialty, and bring the results back together. Matching can consider
availability, relevant experience, proof from completed work, and reputation
within that field. Workstream would also record what was requested, submitted,
checked, and accepted.

AI may suggest how work is divided and routed. Clear rules and accountable
people still approve important assignments, acceptance, payment, and any
reputation change that could affect future opportunities. Workstream is still
being built and remains separate from Garden's workspace and execution tools.

## Deliberate anti-priorities

- Do not delay beta hardening to build a token, blockchain, peer-to-peer
  network, universal scheduler, or generic marketplace.
- Do not describe offline development mode as production local-first or
  self-hosted operation.
- Do not replace the working managed path before a second workload proves the
  minimum portable interface.
- Do not put private, regulated, irreversible, or safety-critical work on
  untrusted community infrastructure.
- Do not reward node count, agent calls, compute advertised, or tasks created;
  measure accepted outcomes, reliability, cost, safety, and repeat demand.

## Beta readiness checklist

- [x] Better Auth origin and cross-site request validation enabled.
- [x] A newcomer can run Garden locally without a Cloudflare account through
      the offline development mode.
- [ ] Cross-workspace isolation and permission-management coverage complete.
- [ ] Core smoke tests pass in continuous integration and staging.
- [ ] Runs have visible, recoverable terminal states with duplicate prevention.
- [ ] Connector failures are explainable and recoverable.
- [ ] Approval and audit paths are trustworthy for risky tools.
- [ ] Backup, restore, release, and rollback procedures are tested.
- [ ] A tester can complete: connect tool → chat → create issue → agent run →
      approve action → review output.
