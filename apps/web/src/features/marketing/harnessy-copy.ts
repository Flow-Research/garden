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
 * Architecture + direction reference for Garden, Harnessy, and Jarvis. It
 * distinguishes Garden's shipped direct-Executor runtime from Harnessy's
 * independent future host contract so this page never implies that Garden
 * bundles or deploys Harnessy today.
 */
export const harnessyPageCopy = {
  eyebrow: 'Architecture & direction',
  title: 'Harnessy, Garden, and Jarvis',
  lede: 'Garden is the product workspace and control plane. Today its connector engine is Executor, running directly inside the Garden Worker. Harnessy is a separate first-party open capability project, not a bundled Garden runtime; Jarvis is the human–agent collaboration protocol coming next. This page separates shipped architecture from product direction. Shipped = native and in use; Building = in progress; Planned / Later = documented direction.',
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
 * The layered system, including the shipped Executor boundary and independent
 * Harnessy direction.
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
    role: 'A separate open capability project: packaging, readiness, verification, runtime-adapter contracts, and evidence. It is not bundled into Garden or used as Garden’s connector engine.',
    openness: 'Open source',
    status: 'building',
  },
  {
    id: 'executor',
    name: 'Executor',
    role: 'Garden’s shipped integration engine: catalog, installation, OAuth, connections, execution, and MCP sessions. The public SDK and Durable Objects run inside the Garden Worker.',
    openness: 'Open source',
    status: 'shipped',
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
 * The proposed Garden ↔ Harnessy boundary. This is direction, not a claim that
 * current Garden connector execution passes through Harnessy.
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
    'This is the proposed host boundary, not today’s runtime topology. Harnessy can own portable capability packaging and evidence contracts; Garden keeps identity, credentials, approvals, storage, and the right to act. Current connector execution remains direct Executor inside Garden.',
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
    'Harnessy is an independent project, not a vendored Garden subsystem. Any future Garden adapter must preserve Garden’s authority boundary and must not duplicate Executor’s integration engine.',
}

/**
 * A current connector run showing the direct Garden ↔ Executor boundary.
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
    'Garden supplies tenant/member identity and policy to the in-process Executor SDK. Executor resolves the installed integration and executes it through the same Garden Worker; Garden owns approval and audit.',
  steps: [
    {
      actor: 'Garden',
      text: 'Authorizes the actor and workspace, resolves product permissions, and opens the tenant/member-scoped Executor boundary.',
    },
    {
      actor: 'Executor',
      text: 'Loads the installed integration and connection, then exposes or executes its tools through the public SDK and hibernatable MCP session.',
    },
    {
      actor: 'Garden agent runtime',
      text: 'Applies the tool’s risk policy, requests approval when required, and invokes the native tool or Executor MCP operation.',
    },
    {
      actor: 'Garden',
      text: 'Persists product outcomes and audit evidence. Executor’s D1/R2 state and MCP Durable Objects remain inside the same Worker deployment.',
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
      purpose:
        'Portable skills, prompts, templates, checks, scripts, and context for a bounded workflow.',
    },
    {
      name: 'Connector pack',
      purpose:
        'Reusable connector operations, schemas, fixtures, checkpoints, and evidence rules.',
    },
    {
      name: 'Runtime-adapter pack',
      purpose:
        'Host/runtime integration for executing capabilities (Garden, Codex, Claude, OpenCode, Pi, CI).',
    },
    {
      name: 'Profile pack',
      purpose:
        'A curated bundle of packs and settings for a persona, org, or product mode.',
    },
    {
      name: 'Policy pack',
      purpose:
        'Review, permission, egress, data, and evidence defaults for an org or channel.',
    },
    {
      name: 'Compatibility pack',
      purpose:
        'Preserves legacy behavior without making it the default (the full v1 surface).',
    },
    {
      name: 'Private workflow pack',
      purpose:
        'Org/user-specific scripts, schedules, and habits — installed only by explicit profile selection.',
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
  summary:
    'Garden’s current integration runtime and Harnessy’s independent direction are separate.',
  status: 'shipped',
  points: [
    'Garden uses Executor v1.5.40 directly for catalog, installation, OAuth, connections, execution, and MCP sessions.',
    'Executor’s MCP session and execution-owner Durable Objects are exported by the Garden Worker; no connector or Harnessy Worker is deployed.',
    'Garden-native GitHub and Discord tools use typed Effect services beside the Executor session.',
    'Harnessy remains a first-party project with its own source, releases, and direction. Garden neither vendors nor bundles it.',
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
    'Define neutral Harnessy capability and evidence contracts without turning Harnessy into Garden’s connector transport.',
    'Add a Garden host adapter only when it composes with Executor instead of replacing or duplicating it.',
    'Add pack-family metadata and profile-pack activation so hosts select packs instead of inheriting one monolithic workflow set.',
    'An agent-first capability runtime that resolves and runs skills, memory, and connectors without hand-run CLI commands.',
    'Knowledge-workflow capabilities — ingest → brief → issues/tasks — and the native Jarvis protocol that Garden then hosts with governance and approvals.',
  ],
}
