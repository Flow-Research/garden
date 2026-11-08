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
  {
    id: 'auth',
    label: 'Cross-site request protection enabled',
    status: 'done',
  },
  {
    id: 'isolation',
    label: 'Workspace separation fully tested',
    status: 'open',
  },
  { id: 'smoke', label: 'Core journeys tested before release', status: 'open' },
  { id: 'runs', label: 'Failed runs recover cleanly', status: 'open' },
  {
    id: 'connectors',
    label: 'Connector engine works inside Garden',
    status: 'done',
  },
  {
    id: 'approvals',
    label: 'Sensitive actions have trusted approvals',
    status: 'open',
  },
  {
    id: 'walkthrough',
    label: 'Internal test journey passes',
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
    title: 'Use Garden for real internal work',
    detail:
      'Start with work we already do every week. Real use will show us what is reliable, what is confusing, and what to fix next.',
    priority: 'high',
    links: [flo(28)],
  },
  {
    ref: 'FLO-31',
    title: 'Make tasks and automations recover cleanly',
    detail:
      'A run should finish, pause safely, or explain why it stopped. We will keep unfinished options out of demos until start, resume, cancel, failure, and recovery all work.',
    priority: 'high',
    evidence: 'packages/agent-runtime/src/run-workflow.ts',
    links: [flo(31)],
  },
  {
    ref: 'SHIPPED',
    title: 'Run the connector engine inside Garden',
    detail:
      'Garden now hosts its connector engine. Garden still owns what people see: connections, workspace rules, approvals, and action history.',
    priority: 'shipped',
    note: 'shipped foundation',
    links: [gh(28)],
  },
  {
    ref: 'FLO-30',
    title: 'Prove workspaces cannot reach each other',
    detail:
      'Add one automated test suite that tries every important path between two workspaces. Every unauthorized attempt must fail.',
    priority: 'high',
    evidence: 'apps/web/src/lib/server/control-plane.ts',
    links: [flo(30), gh(27)],
  },
  {
    ref: 'SECURITY',
    title: 'Close permission gaps',
    detail:
      'The server must check every permission change. Approval requests should go only to people who are allowed to decide. Security details remain private until fixes are deployed.',
    priority: 'high',
    note: 'report details through SECURITY.md',
  },
  {
    ref: 'FLO-32',
    title: 'Test the core journey before release',
    detail:
      'Check login, workspace setup, chat, tasks, automations, approvals, connections, and documents. The full journey should pass without someone repairing data by hand.',
    priority: 'high',
    evidence: 'apps/web/src/server.ts',
    links: [flo(32), gh(33)],
  },
  {
    ref: 'ALIGN',
    title: 'Improve the design in small releases',
    detail:
      'Release one useful part at a time. Tie each change to a real workflow, keep Garden usable, and record why important decisions were made.',
    priority: 'high',
    note: 'design + engineering',
  },
]

/** Work pulled forward after the internal loop is dependable. */
export const betaQuality: WorkItem[] = [
  {
    ref: 'NEXT',
    title: 'Make connected tools dependable',
    detail:
      'Slack, Gmail, Google Drive, and GitHub should do more than show a Connected badge. Permissions, account choice, reconnection, and error messages all need to work clearly.',
    priority: 'high',
    note: 'no Jira dependency',
    links: [gh(48)],
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
    title: 'Make agent failures easier to understand',
    detail:
      'Save the setup behind each run, use clear failure names, keep secrets out of logs, and add tests for problems we need to reproduce.',
    priority: 'medium',
    links: [flo(37), gh(32)],
  },
  {
    ref: 'GH #31',
    title: 'Protect automation triggers',
    detail:
      'Reject fake or repeated requests, record who triggered each run, and make simultaneous runs behave predictably.',
    priority: 'medium',
    links: [gh(31)],
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
    ref: 'RESEARCH',
    title: 'Prove Garden can run beyond one cloud',
    detail:
      'Keep the managed version working, then use one real workflow to test the smallest common interface another provider needs. Start with one private machine, not a cluster.',
    priority: 'low',
  },
  {
    ref: 'RESEARCH',
    title: 'Keep useful work available during an outage',
    detail:
      'Test one useful workflow without a network connection. Save work locally, show conflicts clearly, and wait for confirmed permission before taking actions that cannot be undone.',
    priority: 'low',
  },
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
    title: 'Let independent providers run useful services',
    detail:
      'Qualified operators may later provide computing, storage, AI models, skills, agents, connectors, checking, or hosting. Start only when there is real demand and a safe way to verify the service.',
    priority: 'low',
  },
  {
    ref: 'RESEARCH',
    title: 'Fund useful work before creating new currencies',
    detail:
      'Begin with a fixed pool funded in advance and normal lawful payments. Mutual credit or crypto remains optional research and must never be required for Garden to work.',
    priority: 'low',
  },
  {
    ref: 'WORKSTREAM',
    title: 'Route work by specialty and verified experience',
    detail:
      'Workstream may later divide outcomes into clear tasks, match people and agents using specialty, availability, completed work, and reputation within that field, then bring the results together. AI can recommend; clear rules and accountable people still approve important decisions.',
    priority: 'low',
  },
]

export interface ArchitectureBoundary {
  owner: string
  responsibility: string
}

/** Product boundaries needed to understand current roadmap ownership. */
export const architectureBoundaries: ArchitectureBoundary[] = [
  {
    owner: 'Garden',
    responsibility:
      'The product: workspaces, tasks, agents, automations, policy, approvals, audit, and customer records.',
  },
  {
    owner: 'Executor',
    responsibility:
      'The connector catalog, setup, authentication, tool calls, and live connector sessions inside Garden.',
  },
  {
    owner: 'Cloudflare Workflows',
    responsibility:
      'Long-running work: retries, waits, resumes, cancellation, and final status.',
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
    text: 'Organization-wide memory before a concrete workflow and correction model justify it',
    links: [gh(23), gh(29)],
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
  { text: 'No full platform rewrite for the current beta' },
  { text: 'No customer presented as adopted before commitment' },
  { text: 'No second connector catalog or execution host inside Garden' },
  { text: 'No second retry or recovery layer around Cloudflare Workflows' },
  {
    text: 'No marketplace breadth before the core automation loop is reliable',
  },
  {
    text: 'No token, blockchain, or permissionless production execution before useful demand and safety gates exist',
  },
]

export const roadmapMeta = {
  horizon: 'Now → Next → Later',
  updated: '19 Aug 2026',
  goal: 'First, make Garden dependable for internal use and a small beta. Then use real workflows to prove private deployment, local operation, and services run by independent providers. Funding follows useful work; it does not replace it.',
  boardsUrl: 'https://github.com/Flow-Research/garden/issues',
  sources: [
    {
      label: 'docs/concepts/product/roadmap.md',
      detail: 'beta priorities and longer direction',
    },
    { label: 'workspace board', detail: 'FLO issues' },
    { label: 'GitHub issues', detail: 'execution details' },
    { label: 'team decisions', detail: 'through 19 Aug' },
  ],
}
