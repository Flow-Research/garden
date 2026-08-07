/**
 * /roadmap narrative content.
 *
 * This stays close to the existing beta roadmap and issue inventory. Past
 * enterprise discovery informs the launch bar without turning a prospect into
 * a committed customer plan.
 */

export type GateStatus = 'done' | 'open'

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
  {
    id: 'connectors',
    label: 'Direct Executor boundary proven',
    status: 'done',
  },
  {
    id: 'approvals',
    label: 'Trustworthy approval + audit paths',
    status: 'open',
  },
  {
    id: 'walkthrough',
    label: 'Internal dogfood walkthrough passes',
    status: 'open',
  },
]

export type WorkPriority = 'high' | 'medium' | 'low' | 'shipped'

export interface IssueLink {
  label: string
  href?: string
}

const gh = (number: number): IssueLink => ({
  label: `GH #${number}`,
  href: `https://github.com/Flow-Research/garden/issues/${number}`,
})
const flo = (number: number): IssueLink => ({ label: `FLO-${number}` })

export interface WorkItem {
  ref: string
  title: string
  detail: string
  priority: WorkPriority
  evidence?: string
  note?: string
  links?: IssueLink[]
}

/** Work actively blocking dependable internal use and pilot readiness. */
export const launchGates: WorkItem[] = [
  {
    ref: 'FLO-28',
    title: 'Dogfood Garden on real internal work',
    detail:
      'Start with work we already do every week: GitHub pull-request reviews, meeting transcript processing, internal points, and team operations. Using Garden for real work will tell us what to fix next.',
    priority: 'high',
    links: [flo(28)],
  },
  {
    ref: 'FLO-31',
    title: 'Durable automation and issue runs',
    detail:
      'Automations are the core of Garden. A run should finish, pause cleanly, or tell us why it stopped. Cloudflare Workflows owns retries, waits, resumes, cancellation, and recovery. We will keep unfinished automation options out of demos until the full path works.',
    priority: 'high',
    evidence: 'packages/agent-runtime/src/run-workflow.ts',
    links: [flo(31), gh(31)],
  },
  {
    ref: 'SHIPPED',
    title: 'Run Executor directly in Garden',
    detail:
      'Executor now owns connector catalog, installation, authentication, execution, and MCP sessions inside the Garden Worker. Garden keeps the Connections UI, workspace policy, approvals, and audit history.',
    priority: 'shipped',
    note: 'productivity suite first',
    links: [gh(28)],
  },
  {
    ref: 'FLO-30',
    title: 'Workspace-isolation regression coverage',
    detail:
      'Add one CI suite that tries to cross workspace boundaries through routes, agent RPC, inbox, approvals, documents, attachments, automations, and Executor. It must fail every time.',
    priority: 'high',
    evidence: 'apps/web/src/lib/server/control-plane.ts',
    links: [flo(30), gh(27)],
  },
  {
    ref: 'GH #53',
    title: 'Close permission and authorization gaps',
    detail:
      'Permission grants and admin actions must check explicit capabilities. Access needs clear scope and revocation. A disabled button is not authorization.',
    priority: 'high',
    evidence: 'apps/web/src/routes/api/connections',
    links: [gh(53)],
  },
  {
    ref: 'BLOCKED',
    title: 'Put Garden on garden.flowresearch.tech',
    detail:
      'The production domain is blocked on access to the Flow Research Cloudflare DNS zone. Once that is available, wire the domain, TLS, auth origins, OAuth callbacks, and deployment checks.',
    priority: 'high',
    note: 'blocked: Cloudflare DNS',
  },
  {
    ref: 'FLO-32',
    title: 'Health endpoint and staging smoke suite',
    detail:
      'Add a stable health endpoint and a staging smoke test for login, workspace setup, chat, tasks, automations, approvals, connections, and documents. The internal walkthrough should pass without someone repairing state by hand.',
    priority: 'high',
    evidence: 'apps/web/src/server.ts',
    links: [flo(32), gh(33)],
  },
  {
    ref: 'ALIGN',
    title: 'Implement the new design in shippable slices',
    detail:
      'Move the new design into Garden one working slice at a time. Tie each slice to a real workflow, review it with engineering, and keep the product usable as the new design lands. Record decisions in one shared place so the team knows what changed and why.',
    priority: 'high',
    note: 'design + engineering',
  },
  {
    ref: 'ACTIVE',
    title: 'Start rewriting Garden in Effect-TS',
    detail:
      'Move Garden to Effect in small, shippable slices. Start with core services and runtime paths as they are touched, keep behavior covered by tests, and leave the current product usable throughout the migration.',
    priority: 'high',
    note: 'incremental migration',
  },
]

/** Work pulled forward after the internal loop is dependable. */
export const betaQuality: WorkItem[] = [
  {
    ref: 'NEXT',
    title: 'Make productivity tools dependable',
    detail:
      'Go beyond the Connected badge for Slack, Gmail, Google Drive, and GitHub. Garden needs grounded targets, sensible grants, account routing, reauthorization, and useful errors when a connection breaks.',
    priority: 'high',
    note: 'no Jira dependency',
    links: [gh(37), gh(48)],
  },
  {
    ref: 'NEXT',
    title: 'Tighten the core work loop',
    detail:
      'A user should be able to start in chat, turn the request into a task or automation, hand it to an agent, and get a result they can review. Documents and Inbox should carry the context between those steps.',
    priority: 'high',
  },
  {
    ref: 'FLO-34',
    title: 'Onboarding and failed-run recovery polish',
    detail:
      'Get a new user to one useful automated action quickly. When a run, session, invitation, or connection fails, say what happened and what they can do next.',
    priority: 'medium',
    links: [flo(34)],
  },
  {
    ref: 'FLO-37',
    title: 'Prompt snapshots, traces, and evaluations',
    detail:
      'Save the prompt and runtime configuration behind each run. Use the same failure names across chat, tasks, and automations. Add traces and regression checks where they help us reproduce a real failure.',
    priority: 'medium',
    links: [flo(37), gh(32)],
  },
  {
    ref: 'SOON',
    title: 'Build the knowledge graph and shared memory',
    detail:
      'Let Garden carry useful workspace context across chats, tasks, agents, and automations. Keep sources visible so synthesized memory can be checked and corrected.',
    priority: 'medium',
    links: [gh(23), gh(29)],
  },
  {
    ref: 'PILOT',
    title: 'Try one focused pilot',
    detail:
      'Once our own workflows hold up, pick one real workflow with one partner. Name the owner, required integrations, expected result, and success check. A sales conversation is not an adoption commitment.',
    priority: 'medium',
  },
]

/** Direction beyond the current beta push. */
export const longHorizon: WorkItem[] = [
  {
    ref: 'LATER',
    title: 'Mini apps for repeated workflows',
    detail:
      'Once the same workflows keep showing up, let teams assemble focused screens from tasks, agents, automations, documents, approvals, and external actions.',
    priority: 'low',
  },
  {
    ref: 'LATER',
    title: 'Share proven agents and automations',
    detail:
      'Package agents, skills, automations, integrations, and mini apps only after people reuse them. Installation will need permissions, source history, versions, and predictable upgrades.',
    priority: 'low',
  },
  {
    ref: 'LATER',
    title: 'Enterprise controls when a deal needs them',
    detail:
      'Add SSO, deeper role controls, retention settings, and on-premises deployment when a real deal needs them. We do not need to build the procurement checklist ahead of demand.',
    priority: 'low',
  },
]

export interface ArchitectureBoundary {
  owner: string
  responsibility: string
}

/** Only the C4 boundaries needed to understand current roadmap ownership. */
export const architectureBoundaries: ArchitectureBoundary[] = [
  {
    owner: 'Garden',
    responsibility:
      'The product: workspaces, tasks, agents, automations, policy, approvals, audit, and customer records.',
  },
  {
    owner: 'Executor',
    responsibility:
      'Connector catalog, installation, authentication, execution, and MCP session hosting inside the Garden Worker.',
  },
  {
    owner: 'Cloudflare Workflows',
    responsibility:
      'Durable runs: retries, waits, resumes, cancellation, and final state.',
  },
]

export interface NotNowItem {
  text: string
  links?: IssueLink[]
}

export const deferredUntilEvidence: NotNowItem[] = [
  { text: 'Garden Personal mode and Cave' },
  {
    text: 'Broad marketplace before internal and pilot workflows prove reusable value',
  },
  {
    text: 'Generic visual runtime before mini-app requirements are grounded',
    links: [gh(15)],
  },
  {
    text: 'Enterprise SSO, deep RBAC, and on-premises packaging without a deal requirement',
  },
  {
    text: 'Customer-specific infrastructure or Jira plans without an active pilot',
  },
]

export const antiPriorities: NotNowItem[] = [
  { text: 'No full platform rewrite for the current MVP' },
  { text: 'No customer presented as adopted before commitment' },
  { text: 'No second connector catalog or execution host inside Garden' },
  { text: 'No second retry or recovery layer around Cloudflare Workflows' },
  {
    text: 'No marketplace breadth before the core automation loop is reliable',
  },
]

export const roadmapMeta = {
  horizon: 'Now → Next → Later',
  updated: '17 Jul 2026',
  goal: 'First, make Garden work for us. That means automations we can trust, productivity tools wired through Executor, and the controls an enterprise team will ask for. Once it survives daily use, we can bring in a few focused pilots.',
  boardsUrl: 'https://github.com/Flow-Research/garden/issues',
  sources: [
    { label: 'docs/roadmap.md', detail: 'beta priorities' },
    { label: 'workspace board', detail: 'FLO issues' },
    { label: 'GitHub issues', detail: 'execution details' },
    { label: 'team decisions', detail: 'through 17 Jul' },
  ],
}
