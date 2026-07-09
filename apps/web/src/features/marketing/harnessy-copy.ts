import type { FeatureStatus } from './feature-copy'

/** Openness of a system in the stack. */
export type LayerOpenness = 'Open source' | 'Open core' | 'Closed'

/** One system in the layered architecture. */
export type StackSystem = {
  id: string
  name: string
  role: string
  openness: LayerOpenness
  status: FeatureStatus
}

/** One side of an ownership boundary. */
export type OwnershipSide = {
  owner: string
  lead: string
  items: string[]
}

/** One step in a worked end-to-end run. */
export type FlowStep = {
  actor: string
  text: string
}

/** One pack family in the packaging taxonomy. */
export type PackKind = {
  name: string
  purpose: string
}

/** A narrative section: heading, lede, optional status, and grounded points. */
export type HarnessySection = {
  id: string
  title: string
  summary: string
  status?: FeatureStatus
  points: string[]
}

/**
 * Architecture + direction reference for Garden, grounded in the Flow C4
 * architecture handoff and the Harnessy north-star. Explains the layered
 * system, the ownership boundaries between Garden and Harnessy, how a run
 * actually executes, the packaging model, and the Jarvis collaboration protocol
 * coming next. Architecture and product direction only — commercial, legal,
 * identity-provider, and org-structure decisions are tracked elsewhere.
 */
export const harnessyPageCopy = {
  eyebrow: 'Architecture & direction',
  title: 'Harnessy, Garden, and Jarvis',
  lede: 'The product is a layered system for human-supervised agent work. Garden is the product workspace and control plane; Harnessy is the open capability and connector foundation it runs on; Jarvis is the human–agent collaboration protocol coming next. This page maps the systems, the ownership boundaries between them, and where each is headed. Status is honest: Shipped = native and in use; Building = in progress; Planned / Later = documented direction.',
  columnRole: 'What it is',
  columnOpenness: 'Open / closed',
  columnStatus: 'Status',
  statusLabels: {
    shipped: 'Shipped',
    building: 'In progress',
    planned: 'Planned',
    later: 'Later',
  } satisfies Record<FeatureStatus, string>,
}

/**
 * The layered system. Garden is the product surface and control plane; it runs
 * on the open Harnessy foundation and an agent runtime, and is governed by the
 * Jarvis collaboration protocol.
 */
export const stackSystems: StackSystem[] = [
  {
    id: 'pi',
    name: 'Pi / AgentHarness',
    role: 'The agent runtime: agent loop, session persistence, events, hooks, and sub-agents. Provides execution — not host policy or a hard sandbox by itself.',
    openness: 'Open source',
    status: 'shipped',
  },
  {
    id: 'harnessy',
    name: 'Harnessy',
    role: 'The open capability and connector foundation: packaging, readiness and verification, runtime-adapter contracts, evidence, and reusable connector infrastructure. Portable across hosts; local-first.',
    openness: 'Open source',
    status: 'building',
  },
  {
    id: 'jarvis',
    name: 'Jarvis',
    role: 'The human–agent collaboration protocol: work sessions, policy decisions, requests/reviews/takeovers, contribution and evidence records, and memory/skill proposals. A protocol and records layer — not a runtime, UI, or database.',
    openness: 'Open core',
    status: 'planned',
  },
  {
    id: 'flow',
    name: 'Flow runtime',
    role: 'Garden’s generic workflow layer — workspaces, tasks, agent runs, and events — embedded by Garden through adapters and bridges.',
    openness: 'Closed',
    status: 'building',
  },
  {
    id: 'garden',
    name: 'Garden',
    role: 'The product workspace and control plane: experience, workspace identity, authorization, approvals, durable customer storage, hosted connector sessions, and audit. Runs in Team / Enterprise and Personal modes.',
    openness: 'Closed',
    status: 'building',
  },
  {
    id: 'workstream',
    name: 'Workstream',
    role: 'The task, evaluation, and contribution ledger. Owns work and review records; deliberately does not own the execution workspace.',
    openness: 'Closed',
    status: 'planned',
  },
]

/**
 * The core correction: the Garden ↔ Harnessy line is infrastructure vs
 * authority. Harnessy makes capabilities and connectors portable and
 * verifiable; Garden holds tenancy, credentials, and the right to act.
 */
export const ownership: {
  id: string
  title: string
  summary: string
  harnessy: OwnershipSide
  garden: OwnershipSide
  principle: string
} = {
  id: 'ownership',
  title: 'Garden and Harnessy: who owns what',
  summary:
    'The dividing line is infrastructure vs authority. Harnessy owns reusable connector and capability infrastructure; Garden owns identity, credentials, approvals, and the right to act on a tenant’s behalf. Garden does not own the connector infrastructure — that moves into open Harnessy.',
  harnessy: {
    owner: 'Harnessy owns the infrastructure',
    lead: 'Portable, host-agnostic, verifiable.',
    items: [
      'Capability and connector packaging: manifests, schemas, and pack distribution.',
      'Connector operation contracts: source/sink definitions, normalized record and artifact schemas, and checkpoint / cursor semantics.',
      'Evidence: normalized run evidence, input hashes, proposed-write records, and replay handles.',
      'Verification and readiness: dependency and readiness checks, deterministic checks, fingerprints, and a replay/test harness against fixtures.',
      'Runtime-adapter contracts so the same capability runs across hosts — Garden, Codex, Claude, OpenCode, Pi, CI.',
    ],
  },
  garden: {
    owner: 'Garden owns the authority',
    lead: 'Tenancy, secrets, approvals, and the final write.',
    items: [
      'Tenant and workspace identity, membership, and access control.',
      'OAuth apps and installations, tokens, and secret storage.',
      'Write approvals, oversight gates, and audit logs.',
      'Hosted webhooks and schedulers, and durable customer storage.',
      'The product UI, enterprise administration, and the final external write.',
    ],
  },
  principle:
    'Harnessy owns connector infrastructure, not connector authority. Reusable connector logic is portable; the right to read a tenant’s data or write on its behalf stays with Garden.',
}

/**
 * A worked run (e.g. syncing content to an org wiki) showing the host-contract
 * handoff between Garden and Harnessy.
 */
export const runFlow: {
  id: string
  title: string
  summary: string
  steps: FlowStep[]
  rule: string
} = {
  id: 'how-a-run-works',
  title: 'How a run actually works',
  summary:
    'Garden and Harnessy meet at a host contract. Garden supplies identity, credentials, and policy; Harnessy executes the pack and returns normalized results and evidence; Garden performs and audits any privileged write.',
  steps: [
    {
      actor: 'Garden',
      text: 'Initiates a run and passes a host contract: actor, workspace, connector id, credential handles, allowed scopes, checkpoint handle, destination, approval / write mode, and an audit correlation id.',
    },
    {
      actor: 'Harnessy',
      text: 'Loads the connector / capability pack, checks dependencies and readiness, materializes prompts/templates/scripts, and runs it under that contract via the host’s runtime adapter.',
    },
    {
      actor: 'Harnessy',
      text: 'Emits normalized records, proposed writes, checkpoint updates, content hashes, and an evidence bundle — but performs no privileged write itself.',
    },
    {
      actor: 'Garden',
      text: 'Persists records, applies ACLs, requests approval where required, performs the external write only where permitted, and audits the run.',
    },
  ],
  rule: 'Agents may prepare artifacts; the host performs and records the actual change. No write is claimed without explicit evidence.',
}

/**
 * Packaging model: the core stays small and boring; every workflow is a
 * selected pack rather than a baked-in default.
 */
export const packaging: {
  id: string
  title: string
  summary: string
  kinds: PackKind[]
  points: string[]
} = {
  id: 'packaging',
  title: 'Harnessy stays small; everything else is a pack',
  summary:
    'Harnessy core answers a small set of questions — what is installed, where it came from, what it declares (permissions, data categories, egress, dependencies, blast radius), what it materializes, what checks prove it is ready, which runtime adapter hosts it, and what evidence it produced. Workflows are not baked into the core; they are selected packs.',
  kinds: [
    { name: 'Core package', purpose: 'Stable CLI / library foundation.' },
    {
      name: 'Capability pack',
      purpose: 'Portable skills, prompts, templates, checks, scripts, and context for a bounded workflow.',
    },
    {
      name: 'Connector pack',
      purpose: 'Reusable connector operations, schemas, fixtures, checkpoints, and evidence rules.',
    },
    {
      name: 'Runtime-adapter pack',
      purpose: 'Host/runtime integration for executing capabilities (Garden, Codex, Claude, OpenCode, Pi, CI).',
    },
    {
      name: 'Profile pack',
      purpose: 'A curated bundle of packs and settings for a persona, org, or product mode.',
    },
    {
      name: 'Policy pack',
      purpose: 'Review, permission, egress, data, and evidence defaults for an org or channel.',
    },
    {
      name: 'Compatibility pack',
      purpose: 'Preserves legacy behavior without making it the default (the full v1 surface).',
    },
    {
      name: 'Private workflow pack',
      purpose: 'Org/user-specific scripts, schedules, and habits — installed only by explicit profile selection.',
    },
  ],
  points: [
    'Default install is conservative: install the core, initialize state, add only explicitly selected packs, verify metadata, and materialize into project-local paths.',
    'Global writes — hooks, cron, command shims, skill/agent registration, connector writes — are opt-in, never the default.',
    'The full v1 surface is preserved as a compatibility pack for parity testing and migration, not as the long-term public shape.',
    'A host activates a profile: Garden Enterprise selects enterprise-safe capability, connector, policy, and runtime-adapter packs; a personal mode selects a leaner set.',
  ],
}

/** Why runtime adapters exist. */
export const adapters: HarnessySection = {
  id: 'runtime-adapters',
  title: 'Runtime adapters',
  summary:
    'Harnessy runs in several hosts, not as one always-on service. Adapters translate the Harnessy contract to a specific host’s tools, approvals, connector sessions, and audit.',
  points: [
    'Hosts include Garden’s durable agent runtime, Codex, Claude, OpenCode, Pi / AgentHarness, and CI.',
    'Without adapters, every host would reinvent capability loading, resource layout, policy hooks, evidence shape, and connector execution.',
    'Example: a Garden run needs an org-knowledge capability — Garden provides workspace, actor, policy, credential handles, and storage/evidence callbacks; the adapter converts Harnessy operations into Garden tool calls, approvals, connector sessions, and audit records.',
  ],
}

/**
 * Jarvis: the collaboration protocol coming up — what it owns and, importantly,
 * what it leaves to the host.
 */
export const jarvis: {
  id: string
  title: string
  summary: string
  status: FeatureStatus
  owns: string[]
  notOwns: string[]
  direction: string
} = {
  id: 'jarvis',
  title: 'Jarvis: the collaboration protocol, coming up',
  summary:
    'The layer that governs how humans and agents collaborate — a protocol and a set of records, deliberately not a runtime, UI, or database.',
  status: 'planned',
  owns: [
    'Work sessions: durable records of a bounded human–agent collaboration.',
    'Policy: deny-by-default decisions for meaningful agent actions, plus requests, reviews, and takeovers for human supervision.',
    'Contribution and evidence: inspectable records of work performed and portable evidence bundles for review and audit.',
    'Learning, memory proposals, and skill proposals: governed updates that feed back into capabilities.',
  ],
  notOwns: [
    'UI, identity / auth, databases, queues, and cloud deployment.',
    'Sandboxing, model providers, tool execution, and billing.',
    'Those belong to the host — for the hosted product, that host is Garden.',
  ],
  direction:
    'The first implementation is open, built on Pi; hosts like Garden implement the protocol’s records inside their control plane rather than reimplementing the protocol. It is rebuilt fresh — not ported from the v1 Python engine — with the v1 surface preserved as a compatibility pack so nothing that works today regresses.',
}

/** What is already native and in use. */
export const whereWeAre: HarnessySection = {
  id: 'where-we-are',
  title: 'Where we are',
  summary: 'The open foundation is native and in use, and Garden runs on top of it today.',
  status: 'shipped',
  points: [
    'Harnessy core is native and tested: capability manifest, registry, source resolution, materializer, fingerprints, deterministic checks, dependency checks, profiles, lockfile, runtime assets, and structured JSON output.',
    'The skill decision-trace cluster: validate, create, promote, feedback, trace stats, and quality metrics.',
    'A read-only AnyType connector, dogfooded for meeting ingest — the first probe of the connector boundary.',
    'The full v1 surface preserved as the capability-harnessy-v1-full compatibility pack.',
    'Garden today: workspace shell, agent runtime, the Flow runtime libraries and issue bridge, connectors, and the MCP proxy that brokers connector sessions.',
  ],
}

/** The corrections and the road ahead. */
export const whereWeAreGoing: HarnessySection = {
  id: 'where-were-going',
  title: 'Where we’re going',
  summary:
    'Toward portable connector infrastructure, a pack-centered core, and the native Jarvis protocol Garden hosts.',
  status: 'planned',
  points: [
    'Move reusable connector infrastructure into Harnessy: neutral connector contracts (a connector resource kind, a host-contract type, a run-evidence type) with a Garden host adapter for credentials, policy, checkpoints, storage, approval, and audit.',
    'Rename connector dependencies from Garden-specific labels to neutral Harnessy ones.',
    'Add pack-family metadata and profile-pack activation so hosts select packs instead of inheriting one monolithic workflow set.',
    'An agent-first capability runtime that resolves and runs skills, memory, and connectors without hand-run CLI commands.',
    'Knowledge-workflow capabilities — ingest → brief → issues/tasks — and the native Jarvis protocol that Garden then hosts with governance and approvals.',
  ],
}
