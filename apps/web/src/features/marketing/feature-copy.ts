export type FeatureStatus = 'shipped' | 'building' | 'planned' | 'later'

export type GardenFeature = {
  id: string
  name: string
  tagline: string
  status: FeatureStatus
  group: string
  why: string
  helps: string
  triggered: string
}

export type FeatureGroup = {
  id: string
  title: string
  description: string
}

/**
 * Designer/product reference for Garden — grounded in PRD, garden-os-overview,
 * system-spec, and DEFERRED. Covers shipped surfaces, cross-cutting runtime
 * behavior, and intentional near-term / later bets (not only what is in the rail).
 */
export const featureGroups: FeatureGroup[] = [
  {
    id: 'foundation',
    title: 'Foundation',
    description:
      'Why Garden exists and the product rules that should show up in every surface.',
  },
  {
    id: 'shell',
    title: 'Workspace shell',
    description:
      'How people move through the product — one authenticated workspace, many open contexts.',
  },
  {
    id: 'surfaces',
    title: 'Primary surfaces',
    description:
      'Main areas in the left rail. Most exist in code today but are still being hardened — status reflects that.',
  },
  {
    id: 'runtime',
    title: 'Cross-cutting runtime',
    description:
      'Behaviors that cut across chats, tasks, and automations — trust, runs, artifacts, execution.',
  },
  {
    id: 'next',
    title: 'Next',
    description:
      'Documented direction from garden-os-overview and DEFERRED — design for these without pretending they ship today.',
  },
  {
    id: 'later',
    title: 'Later',
    description:
      'Explicitly deferred bets. Useful for layout reservation and naming, not current UI scope.',
  },
]

export const gardenFeatures: GardenFeature[] = [
  {
    id: 'operating-surface',
    name: 'Company operating surface',
    tagline: 'Humans and agents on the same work primitives',
    status: 'building',
    group: 'foundation',
    why: 'Models are capable; the harness is broken. Most teams either gate AI behind technical setup or trap everyone in disposable chat windows that do not connect to real work.',
    helps: 'Give every role one place to talk to agents, assign work, connect tools, approve risky actions, and compound good process across the workspace.',
    triggered:
      'User creates or joins a workspace. The product assumption is they stay inside this shell for chat, tasks, automations, and triage — not a separate chat app.',
  },
  {
    id: 'principles',
    name: 'Raise the floor, not the ceiling',
    tagline: 'Three operating principles',
    status: 'shipped',
    group: 'foundation',
    why: 'Non-technical users need rails; power users need full capability. Simplifying by hiding options fails both.',
    helps: 'Design for one product mode: approachable defaults, advanced depth still reachable. Skills, permissions, and agent config compound so one person’s breakthrough becomes everyone’s baseline. The UI teaches in-flow instead of requiring workshops.',
    triggered:
      'Shows up in copy, empty states, permission defaults, skill sharing, and nudges during real work — not a separate “advanced settings” product.',
  },
  {
    id: 'workspace-shell',
    name: 'Tabbed workspace',
    tagline: 'Rail, explorer, and docked panels',
    status: 'shipped',
    group: 'shell',
    why: 'Work is multi-threaded. Page-switching loses context; a code-editor-style shell keeps inbox, chat, task detail, and settings visible as parallel tabs.',
    helps: 'Open many contexts at once, switch without losing panel state, and keep humans oriented with a stable left rail plus contextual explorer.',
    triggered:
      'User signs in and lands in `/workspace`. They open panels from the rail, explorer, or in-panel actions; tabs persist across reloads.',
  },
  {
    id: 'home',
    name: 'Home',
    tagline: 'Reorientation, not vanity metrics',
    status: 'building',
    group: 'surfaces',
    why: 'Shared human/agent workspaces need a calm first view before diving into threads and runs.',
    helps: 'Surface open work, recent activity, and connection health so someone can decide what to open next.',
    triggered: 'User selects Home in the left rail or returns after sign-in.',
  },
  {
    id: 'chats',
    name: 'Chats',
    tagline: 'Persistent agent threads',
    status: 'building',
    group: 'surfaces',
    why: 'Delegation and Q&A are ongoing. Each thread needs its own transcript, tools, and documents — not one mutable session for everything.',
    helps: 'Talk to an agent, watch tool use live, attach documents, approve actions inline, and resume the same thread later.',
    triggered:
      'User opens Chats and starts or continues a thread. Each thread maps to a dedicated chat facet in the agent runtime.',
  },
  {
    id: 'tasks',
    name: 'Tasks',
    tagline: 'Issues as shared work items',
    status: 'building',
    group: 'surfaces',
    why: 'Agents and people must share one record of what needs doing — kanban for humans, assignable runs for agents.',
    helps: 'Track status, owner (human or agent), comments, activity, and work products on the same card.',
    triggered:
      'User creates a task, asks an agent to create one, or an automation opens a task when follow-up is required.',
  },
  {
    id: 'inbox',
    name: 'Inbox',
    tagline: 'Human attention queue',
    status: 'building',
    group: 'surfaces',
    why: 'Fast agents plus connected tools need a single triage surface for judgment — not silent sends or scattered approval modals.',
    helps: 'Review permission requests, mentions, blockers, and failed runs; approve once or adjust trust for next time.',
    triggered:
      'Agent hits an `ask` grant, someone @mentions the user, or a run fails and needs a decision.',
  },
  {
    id: 'automations',
    name: 'Automations',
    tagline: 'Separate routine ledger',
    status: 'building',
    group: 'surfaces',
    why: 'Scheduled and webhook-driven work is not the same primitive as kanban tasks — it needs its own templates, triggers, and run history.',
    helps: 'Run digests, triage passes, QA sweeps, and reminders on cron, manual trigger, or webhook without creating issue cards.',
    triggered:
      'User creates an automation from a typed template, configures schedule or webhook, and enables it. Runs appear in the automation’s own history.',
  },
  {
    id: 'agents',
    name: 'Agents',
    tagline: 'Workspace roster and config',
    status: 'building',
    group: 'surfaces',
    why: 'Every member gets a personal agent at signup, but teams also add shared specialists — each needs persona, skills, and connector grants.',
    helps: 'Browse agents, edit instructions, assign skills, and set per-tool trust before work starts.',
    triggered:
      'Personal agent exists after signup. User opens Agents in the rail to configure or add workspace agents.',
  },
  {
    id: 'skills',
    name: 'Skills',
    tagline: 'Know-how built into the product',
    status: 'building',
    group: 'surfaces',
    why: 'Process should not live in one person’s prompts or a separate “AI tools” folder. Skills are how Garden compounds wins inside a workspace — not a marketplace, but a library every agent can draw from.',
    helps: 'Author `SKILL.md` in-app, import from skills.sh, assign skills to agents, and load them during chats, task runs, and automations. The goal is one teammate’s playbook becoming default behavior for every agent.',
    triggered:
      'User opens Skills in the rail to create or import. Agents pick up assigned skills at runtime. In-flow suggestions (when a skill fits the moment) are planned — still building.',
  },
  {
    id: 'connections',
    name: 'Connections',
    tagline: 'MCP connectors with OAuth',
    status: 'building',
    group: 'surfaces',
    why: 'Agents only act where they can read and write. Garden fronts official upstream MCP servers — it does not re-implement SaaS APIs.',
    helps: 'Connect Gmail, Google Drive, Slack, GitHub, and Exa Search today; expose typed tools with honest risk classes.',
    triggered:
      'User authenticates a connector in Connections. Tools become available to agents subject to per-agent grants.',
  },
  {
    id: 'delegation',
    name: 'Hiring and sub-agents',
    tagline: 'Persistent colleagues vs ephemeral runs',
    status: 'building',
    group: 'runtime',
    why: 'Some specialties belong on the roster; others are one job. Mixing them crowds chat context and blurs ownership.',
    helps: 'Add persistent agents for new specialties, or spin ephemeral sub-agents scoped to a chat, issue run, or automation run.',
    triggered:
      'Agent or user creates a workspace agent for ongoing roles. Bounded work spawns a sub-agent facet that reclaims after the run completes.',
  },
  {
    id: 'runs',
    name: 'Durable runs',
    tagline: 'Workflow-backed execution',
    status: 'building',
    group: 'runtime',
    why: 'Agent work can take minutes or hours. In-memory chat is the wrong place to own retry, wait, resume, and cancel.',
    helps: 'Issue runs and automation runs keep a ledger, stream activity to the UI, and survive restarts through Cloudflare Workflows.',
    triggered:
      'User assigns an agent to a task or an automation fires. `RunWorkflow` owns the long-running boundary between Think turns.',
  },
  {
    id: 'permissions',
    name: 'Permissions and approvals',
    tagline: 'auto · allow · ask',
    status: 'building',
    group: 'runtime',
    why: 'Trust must be explicit per agent and per tool — reads can flow, writes and external sends need human gates when configured.',
    helps: 'Classify connector tools by risk, set grants, audit every call, and pause the agent until inbox or inline approval resolves.',
    triggered:
      'Agent calls a tool. Grant level and risk class decide silent proceed, audit-only proceed, or approval request.',
  },
  {
    id: 'documents',
    name: 'Document artifacts',
    tagline: 'Versioned outputs tied to work',
    status: 'building',
    group: 'runtime',
    why: 'Drafts and reports should not vanish in chat scrollback. They need identity, versions, edits, and preview.',
    helps: 'Generate, upload, edit with tracked changes, accept/reject, convert to PDF, and cite sources from chat or task context.',
    triggered:
      'User uploads in chat or an agent calls document tools during a thread or run. Artifacts open from that context today (not a global docs tab yet).',
  },
  {
    id: 'sandbox',
    name: 'Sandboxes and codemode',
    tagline: 'Isolated code execution',
    status: 'building',
    group: 'runtime',
    why: 'Some work is a script, transform, or small app — not a connector call. Agents need a real execution environment with streamed output.',
    helps: 'Run code in Cloudflare Sandboxes, stream logs to chat, and share preview URLs when the agent stands up a service.',
    triggered:
      'Agent invokes codemode or sandbox tools during chat or a typed automation that declares execution capabilities.',
  },
  {
    id: 'workspaces',
    name: 'Workspaces and membership',
    tagline: 'Company boundary',
    status: 'building',
    group: 'runtime',
    why: 'Skills, agents, connectors, and audit are workspace-scoped. Tenancy must be obvious for design and permissions.',
    helps: 'Invite teammates, manage roles (owner/admin/member), and keep each company’s agents and data isolated.',
    triggered: 'User signs up (new workspace) or accepts an invitation to join an existing one.',
  },
  {
    id: 'memory',
    name: 'Memory synthesis',
    tagline: 'Shared baseline behind consent',
    status: 'planned',
    group: 'next',
    why: 'Re-explaining context every session wastes time. Glass-style memory mines sessions and connected tools into durable files — with user review before commit.',
    helps: 'Let agents start with people, projects, and channels already mapped; approve or dismiss pending memory updates.',
    triggered:
      'Planned: periodic synthesis job plus inbox-style review queue. Per-agent memory already lives in each agent’s durable object.',
  },
  {
    id: 'headless',
    name: 'Headless and Slack entry',
    tagline: 'Agent outside the web shell',
    status: 'planned',
    group: 'next',
    why: 'Work happens in Slack and on phones. Long runs should not require staring at a browser tab.',
    helps: 'Slack-native assistant in channels, API/script triggers, and mobile-friendly approval for permission requests.',
    triggered:
      'Planned: Slack event → agent facet; scheduled/API triggers already align with automation webhooks.',
  },
  {
    id: 'multi-pane',
    name: 'Multi-pane workspace',
    tagline: 'Side-by-side tabs',
    status: 'planned',
    group: 'next',
    why: 'Triage often means inbox beside issue, or chat beside document. Single-focus tabs force too much switching.',
    helps: 'Tile two panels horizontally or vertically while keeping the same rail and explorer model.',
    triggered:
      'Planned: user splits the dock like a code editor. FlexLayout already supports splitters — product UX catches up.',
  },
  {
    id: 'skill-recommender',
    name: 'Skills in the flow of work',
    tagline: 'Suggest the right skill at the right moment',
    status: 'planned',
    group: 'next',
    why: 'A workspace library only helps if people discover skills during real tasks — not by browsing a catalog.',
    helps: 'Nudge users and agents when a skill matches role, connected tools, or current chat/task context. Part of the same skills bet, not a separate product surface.',
    triggered:
      'Planned: prompts in chat, task setup, or automation builder when telemetry matches an assigned or available skill.',
  },
  {
    id: 'visual-runtime',
    name: 'Visual runtime',
    tagline: 'Charts, diagrams, rendered artifacts',
    status: 'later',
    group: 'later',
    why: 'System spec calls for agent-authored visuals — explainers, mockups, bounded UI — not just markdown in chat.',
    helps: 'Render safe HTML/SVG/chart artifacts inline with theme tokens and export rules.',
    triggered: 'Deferred until document artifact loop is stable and product needs structured visuals beyond prose.',
  },
  {
    id: 'knowledge-graph',
    name: 'Knowledge graph',
    tagline: 'Relationships across connected tools',
    status: 'later',
    group: 'later',
    why: 'Once connector data flows broadly, flat search is not enough — people, issues, docs, and channels link to each other.',
    helps: 'Answer “what touches this account?” or “who owns this doc?” across Gmail, Slack, GitHub, and internal work.',
    triggered: 'Deferred until connector reliability and memory scope are proven in beta.',
  },
  {
    id: 'review-grid',
    name: 'Review Grid',
    tagline: 'Workspace-level artifact review',
    status: 'later',
    group: 'later',
    why: 'Thread-scoped documents work for chat-first flows; teams will want a dedicated review surface for many artifacts at once.',
    helps: 'Scan, compare, and approve agent outputs across tasks without opening each thread.',
    triggered: 'Deferred — depends on document artifact maturity and workspace-level tabs.',
  },
]

export const featuresPageCopy = {
  eyebrow: 'Product reference',
  title: 'Garden features',
  lede: 'What each capability is for, what job it does, and what typically starts it. Status is honest: Shipped = stable foundation in prod; Building = in the product but incomplete; Planned / Later = documented direction.',
  columnWhy: 'Why it exists',
  columnHelps: 'What it helps us do',
  columnTriggered: 'How it’s triggered',
  statusLabels: {
    shipped: 'Shipped',
    building: 'In progress',
    planned: 'Planned',
    later: 'Later',
  } satisfies Record<FeatureStatus, string>,
}
