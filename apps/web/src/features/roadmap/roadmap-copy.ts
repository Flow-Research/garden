/**
 * /roadmap — all narrative content for the public roadmap page.
 *
 * This file is a hand-reconciled snapshot (2026-07-16) of the sources that
 * previously had to be read separately to understand where Garden stands:
 *
 *   1. docs/known-gaps/*.md            — code-verified gap inventory (2026-07-12)
 *   2. docs/roadmap.md                 — beta / soft-launch priorities
 *   3. Garden workspace issue board    — FLO-nn issues (DB snapshot 2026-07-16)
 *   4. github.com/Flow-Research/garden — open GitHub issues
 *   5. artifacts/roadmap/garden-internal-product-roadmap.xlsx — pilot weekly plan
 *
 * Issues are folded in contextually: each work item carries its tracker
 * references as links, and GitHub numbers only appear where the mapping is
 * real (FLO-nn and GH #nn numbering are unrelated). There is deliberately no
 * "issue board dump" section — the trackers stay the system of record and the
 * footer links to them. Test-fixture issues are excluded.
 */

export type GateStatus = 'done' | 'open'

/** Beta readiness checklist from docs/roadmap.md — the launch bar. */
export interface ReadinessGate {
  id: string
  label: string
  status: GateStatus
}

export const readinessGates: ReadinessGate[] = [
  { id: 'auth', label: 'Origin + CSRF validation enabled', status: 'done' },
  { id: 'isolation', label: 'Workspace-isolation coverage', status: 'open' },
  { id: 'smoke', label: 'Smoke tests in CI + staging', status: 'open' },
  { id: 'runs', label: 'Recoverable run terminal states', status: 'open' },
  { id: 'connectors', label: 'Explainable connector failures', status: 'open' },
  { id: 'approvals', label: 'Trustworthy approval + audit paths', status: 'open' },
  { id: 'walkthrough', label: 'Full tester walkthrough passes', status: 'open' },
]

export type WorkPriority = 'high' | 'medium' | 'low' | 'shipped'

/** A tracker reference attached to a work item. href only when public. */
export interface IssueLink {
  label: string
  href?: string
}

const gh = (n: number): IssueLink => ({
  label: `GH #${n}`,
  href: `https://github.com/Flow-Research/garden/issues/${n}`,
})
const flo = (n: number): IssueLink => ({ label: `FLO-${n}` })

/** A single tracked piece of work — doc-verified gap with tracker links. */
export interface WorkItem {
  /** Primary ref shown on the card face. */
  ref: string
  title: string
  detail: string
  priority: WorkPriority
  /** Repo evidence path(s), rendered mono. */
  evidence?: string
  /** Extra status note, e.g. cross-tracker drift. */
  note?: string
  /** Tracker references, rendered as chips; linked when public. */
  links?: IssueLink[]
}

export const launchGates: WorkItem[] = [
  {
    ref: 'FLO-30',
    title: 'Workspace-isolation regression coverage',
    detail:
      'Isolation is application-enforced, not DB-RLS-backed, and no single regression suite exercises it across routes, agent RPC, inbox, approvals, documents, and attachments. One suite, run in CI, before beta.',
    priority: 'high',
    evidence: 'apps/web/src/lib/server/control-plane.ts',
    links: [flo(30), gh(27)],
  },
  {
    ref: 'GH #53',
    title: 'Permission grant route missing authz',
    detail:
      'G-TM-03 from the threat model: the grant route does not require the permissionManage capability, so it trusts callers it should not. Straight security fix, gated on nothing.',
    priority: 'high',
    evidence: 'apps/web/src/routes/api/connections',
    links: [gh(53)],
  },
  {
    ref: 'FLO-31',
    title: 'Run lifecycle proven in staging',
    detail:
      'Issue and automation runs must start, wait, resume, cancel, fail, and recover cleanly through RunWorkflow — no stuck running rows, duplicate starts, orphaned active runs, or hidden failure reasons.',
    priority: 'high',
    evidence: 'packages/agent-runtime/src/run-workflow.ts',
    links: [flo(31)],
  },
  {
    ref: 'FLO-32',
    title: 'Health endpoint and beta smoke suite',
    detail:
      'A stable /api/health contract plus smoke coverage for login/workspace, chat, issue runs, automation runs, and document artifacts — running against staging, not just local.',
    priority: 'high',
    evidence: 'apps/web/src/server.ts',
    links: [flo(32), gh(33)],
  },
]

export const betaQuality: WorkItem[] = [
  {
    ref: 'FLO-29',
    title: 'Email notifications for mentions and inbox items',
    detail:
      'Resend-backed delivery so mentions, approvals, and inbox items reach people who are not currently in the app. High on the workspace board since 10 Jul.',
    priority: 'high',
    links: [flo(29)],
  },
  {
    ref: 'FLO-34',
    title: 'Onboarding and failed-run recovery polish',
    detail:
      'A shorter path from signup to a useful agent action, plus clear explanations and recovery for failed runs, missing workspace state, expired sessions, invitations, and reconnects.',
    priority: 'medium',
    links: [flo(34)],
  },
  {
    ref: 'FLO-36',
    title: 'Reverse issue-chat breadcrumbs and multi-issue links',
    detail:
      'Chat already links to one primary issue; issues cannot point back to their source chat, and a thread cannot anchor more than one issue.',
    priority: 'medium',
    links: [flo(36), gh(34)],
  },
  {
    ref: 'FLO-37',
    title: 'Prompt snapshots, tracing, and evaluation coverage',
    detail:
      'Store prompt/config versions and bounded context snapshots, define a shared failure taxonomy, expose secret-safe traces, and add regression evals across chat, issue, and automation runtimes.',
    priority: 'medium',
    links: [flo(37), gh(32)],
  },
  {
    ref: 'FLO-38',
    title: 'Automation trigger contracts and concurrency',
    detail:
      'Typed webhook/API authentication, replay protection, idempotency, and attribution — and either implement queue concurrency end to end or remove it from supported configuration.',
    priority: 'medium',
    links: [flo(38), gh(31)],
  },
  {
    ref: 'FLO-28',
    title: 'Code-review automation built in Garden',
    detail:
      'Dogfood the automations surface on our own pull requests — the first automation template with real daily stakes.',
    priority: 'high',
    links: [flo(28)],
  },
]

/** Shipped recently — kept visible so progress reads at a glance. */
export const shippedRecently: WorkItem[] = [
  {
    ref: 'FLO-27',
    title: 'Better Auth origin and CSRF checks restored',
    detail:
      'disableCSRFCheck and disableOriginCheck are explicitly false again, with focused tests covering trusted, foreign, missing, and null origins. Merged to main 16 Jul.',
    priority: 'shipped',
    evidence: 'apps/web/src/lib/auth/instance.ts',
    note: 'GH #54 close pending',
    links: [gh(54), gh(27)],
  },
  {
    ref: 'FLO-35',
    title: 'Existing-thread-document picker in chat',
    detail:
      'The composer lists thread documents and sends selected current-version identity through turn-scoped document context. Merged to main 16 Jul; the file-artifact handoff half of GH #7 remains open.',
    priority: 'shipped',
    evidence: 'apps/web/src/features/chat/components/chat-composer.tsx',
    links: [flo(35), gh(7)],
  },
  {
    ref: 'FLO-15',
    title: 'Tag workspace members from chat',
    detail:
      'Mention members to reference, assign, or pull context. Done on the workspace board since late June — the GitHub twin is still open.',
    priority: 'shipped',
    note: 'GH #41 close pending',
    links: [gh(41)],
  },
  {
    ref: 'FLO-14',
    title: 'Workspace no longer switches on return navigation',
    detail:
      'Returning from another web route used to land you in a different workspace. Fixed and verified; the GitHub twin is still open.',
    priority: 'shipped',
    note: 'GH #40 close pending',
    links: [gh(40)],
  },
]

export const connectorTrust: WorkItem[] = [
  {
    ref: 'HIGH',
    title: 'Unify capability awareness',
    detail:
      'MCP tools, permission grants, workspace inventory, and agent proposal each hold their own view. propose_agent captures connector requirements, but approval never turns them into first-class permission grants.',
    priority: 'high',
    evidence: 'packages/agent-runtime/src/runtime-mcp-controller.ts',
    links: [gh(28)],
  },
  {
    ref: 'MED',
    title: 'MCP proxy hardening',
    detail:
      'HTTP auth validates agent and workspace but not explicit user membership; approval reuse is not scoped per issue/run; audit failures do not fail closed for risky tools.',
    priority: 'medium',
    evidence: 'workers/mcp-proxy/src',
    links: [gh(28)],
  },
  {
    ref: 'MED',
    title: 'Permission defaults and approval targeting',
    detail:
      'Follow-through from the 20 Jun permission-defaults postmortem: sane grant defaults per risk class, and approval requests routed to the right recipients.',
    priority: 'medium',
    links: [gh(37)],
  },
  {
    ref: 'FLO-39',
    title: 'Google Workspace org-drive auth design',
    detail:
      'Route Google Workspace tool calls across member-owned accounts instead of one shared grant — filed 15 Jul, pairs with the GitHub twin.',
    priority: 'medium',
    links: [flo(39), gh(48)],
  },
  {
    ref: 'FLO-40',
    title: 'Agents hallucinate GitHub owner/org names',
    detail:
      'Connector calls need grounded owner/repo resolution instead of trusting the model to remember which org it is in. Filed 15 Jul.',
    priority: 'medium',
    links: [flo(40)],
  },
  {
    ref: 'MED',
    title: 'Scheduled capability drift check',
    detail:
      'Catalog sync runs on OAuth callback and connection actions only — nothing periodically reconciles against upstream tools/list.',
    priority: 'medium',
    evidence: 'apps/web/src/lib/server/capability-sync.ts',
  },
  {
    ref: 'MED',
    title: 'One source of truth for MCP sessions',
    detail:
      'Runtime session state splits between Postgres truth and per-DO warm cache. Cleanup is guarded now, but agent archive, issue-run terminal states, and workspace deletion still need a real pass.',
    priority: 'medium',
    evidence: 'packages/agent-runtime/src/runtime-mcp-controller.ts',
  },
  {
    ref: 'FLO-20',
    title: 'GitHub connector write grants for Flow Research',
    detail:
      'The write path is blocked on grant configuration for our own workspace — also what blocks mirroring issues to the official repo.',
    priority: 'medium',
    links: [flo(20), gh(39)],
  },
  {
    ref: 'MED',
    title: 'Exa search as a built-in tool',
    detail:
      'Web search is a first-class agent capability, not an integration; routing it through the connector system is the wrong abstraction.',
    priority: 'medium',
    evidence: 'packages/connectors/src/exa-search',
  },
]

/** One column of a pilot week's work, keyed by workstream lane. */
export interface PilotLane {
  lane: string
  work: string
}

/** Ordered pilot phase ids — also the valid values for the ?week= param. */
export const pilotWeekIds = [
  'now',
  'w1',
  'w2',
  'w3',
  'w4',
  'w5',
  'w6',
  'w78',
  'later',
] as const

export type PilotWeekId = (typeof pilotWeekIds)[number]

/** A week entry in the Moniepoint pilot plan (from the roadmap xlsx). */
export interface PilotWeek {
  id: PilotWeekId
  label: string
  goal: string
  lanes: PilotLane[]
  doneWhen: string
}

export const pilotStance =
  'Garden is a company operating surface, not a chatbot. Near-term priority is proving the Moniepoint QA/work loop on a real deployment path — client-owned Cloudflare first. Scope stays narrow: safe deploy, governed connectors, visible work products, approval-first writeback, audit and cost.'

export const pilotWeeks: PilotWeek[] = [
  {
    id: 'now',
    label: 'Now',
    goal: 'Make the pilot deployable and safe before more feature work.',
    lanes: [
      {
        lane: 'Deploy + auth',
        work: 'Merge initial deploy, auth origin checks, and workspace isolation into one launch gate — envs, bindings, secrets, OAuth callbacks per environment.',
      },
      {
        lane: 'Pilot loop',
        work: 'Confirm the QA loop shape: issue in → agent work product → approval → writeback → audit/cost.',
      },
      {
        lane: 'Connectors',
        work: 'Freeze the connector contract — Jira and Slack enter the same permission/audit system as GitHub.',
      },
      {
        lane: 'Runtime',
        work: 'Map the current run path. RunWorkflow stays the durable boundary; no queue or recovery layer.',
      },
    ],
    doneWhen:
      'One deploy checklist exists, the auth gap is owned, and the Moniepoint path is first-class — not later.',
  },
  {
    id: 'w1',
    label: 'W1',
    goal: 'Stand up the first pilot environment path.',
    lanes: [
      {
        lane: 'Deploy + auth',
        work: 'Staging + pilot profile: Worker bindings, DO namespaces, R2 buckets, Neon branch, OAuth callbacks, model gateway placeholders.',
      },
      {
        lane: 'Pilot loop',
        work: 'Write the exact QA pilot script — one representative issue flow with a defined expected deliverable.',
      },
      {
        lane: 'Connectors',
        work: 'Jira connector skeleton: manifest, OAuth/scopes decision, risk classes, initial read/search issue.',
      },
      {
        lane: 'Runtime',
        work: 'Run lifecycle smoke — an issue run starts, waits, finishes, and fails visibly.',
      },
    ],
    doneWhen:
      'Staging/pilot config can deploy; the QA loop has a concrete script and a first Jira read path.',
  },
  {
    id: 'w2',
    label: 'W2',
    goal: 'Turn the QA loop into a working vertical slice.',
    lanes: [
      {
        lane: 'Deploy + auth',
        work: 'Health checks across web, DB, AgentDO, R2/files, model gateway, and connector auth.',
      },
      {
        lane: 'Pilot loop',
        work: 'Source issue → agent QA deliverable. A plan, checklist, or review summary — not a transcript.',
      },
      {
        lane: 'Connectors',
        work: 'Jira read + comment path. Slack stays notification-only until the QA loop works.',
      },
      {
        lane: 'Runtime',
        work: 'Automation and issue-run recovery tests — cancel, fail, and recover paths are visible.',
      },
    ],
    doneWhen: 'A pilot issue produces a reviewable Garden work product from scoped context.',
  },
  {
    id: 'w3',
    label: 'W3',
    goal: 'Add approval-first writeback.',
    lanes: [
      {
        lane: 'Deploy + auth',
        work: 'Rollback and emergency revocation notes for staging and pilot.',
      },
      {
        lane: 'Pilot loop',
        work: 'Human approval before any external write. Approve or deny in Garden; writeback posts only after approval.',
      },
      {
        lane: 'Connectors',
        work: 'Jira writeback — comment, transition, and create-linked-issue as scoped capabilities.',
      },
      {
        lane: 'Runtime',
        work: 'Audit every external action. Risky audit failure fails closed.',
      },
    ],
    doneWhen: 'External writes happen exactly once and only after approval. Denial writes nothing.',
  },
  {
    id: 'w4',
    label: 'W4',
    goal: 'Bring Slack into the pilot loop.',
    lanes: [
      {
        lane: 'Deploy + auth',
        work: 'Moniepoint Cloudflare bootstrap doc: token scopes, Access policy, logs, owner responsibilities.',
      },
      {
        lane: 'Pilot loop',
        work: 'Slack notification and approval recovery. Garden remains the source of truth; Slack helps triage and resume.',
      },
      {
        lane: 'Connectors',
        work: 'Slack app hardening — scopes, admin approval expectations, rate limits, reauth and degraded states.',
      },
      {
        lane: 'Runtime',
        work: 'Connector health states: connected, degraded, reauth, missing scopes.',
      },
    ],
    doneWhen: 'Slack alerts the right people and failed connector auth has clear recovery.',
  },
  {
    id: 'w5',
    label: 'W5',
    goal: 'Make pilot controls inspectable.',
    lanes: [
      {
        lane: 'Deploy + auth',
        work: 'GKE gateway contract review — approved capabilities only; no raw ClickHouse, Redis, or internal DB access.',
      },
      {
        lane: 'Pilot loop',
        work: 'Pilot dashboard basics: runs, status, approvals, writeback target, result link.',
      },
      {
        lane: 'Connectors',
        work: 'Audit drawer / recent activity — agent, connector, tool, target, approval, status.',
      },
      {
        lane: 'Runtime',
        work: 'Run metadata cleanup: selected model, usage, cost estimate where available.',
      },
    ],
    doneWhen:
      'A reviewer can answer: what happened, who approved it, what did it cost, where did it write?',
  },
  {
    id: 'w6',
    label: 'W6',
    goal: 'Add model policy shape without overbuilding.',
    lanes: [
      {
        lane: 'Deploy + auth',
        work: 'AI Gateway mode selected for the pilot — Moniepoint-owned preferred, Flow fallback acceptable.',
      },
      {
        lane: 'Pilot loop',
        work: 'Cost per useful output visible enough for a pilot decision.',
      },
      {
        lane: 'Connectors',
        work: 'Capability inventory agrees with the UI and the agent prompt.',
      },
      {
        lane: 'Runtime',
        work: 'Workspace model policy draft: allowed/default models, task routes, fallback, budget cap, retention mode.',
      },
    ],
    doneWhen: 'Run detail explains model choice, fallback, tokens, and rough cost.',
  },
  {
    id: 'w78',
    label: 'W7–8',
    goal: 'Pilot hardening and decision evidence.',
    lanes: [
      {
        lane: 'Deploy + auth',
        work: 'Rollback drill and access revocation rehearsal.',
      },
      {
        lane: 'Pilot loop',
        work: 'Repeat the QA loop with real users — track completed runs, writeback success, failures, support hours.',
      },
      {
        lane: 'Connectors',
        work: 'Security scenarios: prompt injection, overreach, stale OAuth, secret leakage.',
      },
      {
        lane: 'Runtime',
        work: 'No duplicate or stuck runs. Blocked states explain why the agent stopped.',
      },
    ],
    doneWhen: 'The convert / extend / narrow decision has evidence, not vibes.',
  },
  {
    id: 'later',
    label: 'Later',
    goal: 'Pull forward only from measured pain.',
    lanes: [
      {
        lane: 'Deploy + auth',
        work: 'Enterprise SSO, RBAC, and on-prem only if a deal requires them.',
      },
      {
        lane: 'Pilot loop',
        work: 'More templates after the QA wedge proves repeatable value.',
      },
      {
        lane: 'Connectors',
        work: 'Confluence after Jira; internal capabilities through the gateway only.',
      },
      {
        lane: 'Runtime',
        work: 'Memory synthesis, headless Slack/API/scheduled scripts, knowledge graph, Review Grid, workspace artifact tabs.',
      },
    ],
    doneWhen: 'The next cycle is chosen from pilot evidence.',
  },
]

/** A refused-for-now entry, with tracker links where a bet is already filed. */
export interface NotNowItem {
  text: string
  links?: IssueLink[]
}

/** Deferred-until-evidence list from docs/roadmap.md, cross-linked to bets. */
export const deferredUntilEvidence: NotNowItem[] = [
  {
    text: 'Workspace-wide realtime bus — mounted chat streams and bounded polling hold until beta shows pain',
    links: [gh(6)],
  },
  {
    text: 'Parent-backed shared memory, files, MCP state, and cross-chat search',
    links: [gh(23), gh(29)],
  },
  { text: 'Workspace ↔ container sandbox storage bridge', links: [gh(21)] },
  { text: 'Workspace-level artifact tabs and Review Grid' },
  { text: 'Visual runtime — HTML/SVG rendering, charts, widgets', links: [gh(15)] },
  {
    text: 'Platform bets: connector functions, workflow engine, departments, computer-use contract',
    links: [gh(47), gh(43), gh(42), gh(22)],
  },
  { text: 'Broader connector marketplace' },
  { text: 'Pricing and billing polish', links: [gh(9)] },
]

/** Anti-priorities — explicit do-not-build list from docs/roadmap.md. */
export const antiPriorities: NotNowItem[] = [
  { text: 'No issue-backed automation compatibility' },
  { text: 'No queue dispatch between AgentDO and RunWorkflow' },
  { text: 'No collapsing chats into one mutable Think session' },
  { text: 'No app-wide realtime before measured need' },
  { text: 'No pretending Sandbox /workspace and Think Workspace share storage' },
]

export const roadmapMeta = {
  horizon: 'Beta / soft launch',
  updated: '16 Jul 2026',
  goal: 'Garden should survive real use by a small beta group without data leaks, stuck runs, silent failures, or confusing recovery paths. Product can stay narrow; it cannot feel fragile.',
  boardsUrl: 'https://github.com/Flow-Research/garden/issues',
  sources: [
    { label: 'docs/known-gaps', detail: 'gap inventory, 12 Jul' },
    { label: 'docs/roadmap.md', detail: 'beta priorities' },
    { label: 'workspace board', detail: 'FLO issues, 16 Jul' },
    { label: 'GitHub issues', detail: 'open set' },
    { label: 'pilot plan xlsx', detail: 'weekly plan' },
  ],
}
